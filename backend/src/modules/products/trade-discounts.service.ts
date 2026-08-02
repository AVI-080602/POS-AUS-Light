import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Category } from './entities/category.entity';
import { Product } from './entities/product.entity';
import { SettingsService } from '../settings/settings.service';
import {
  TradeRule,
  DEFAULT_TRADE_RULES,
  normaliseTradeRules,
} from './trade-rules.defaults';

// Trade auto-discounts mirror the Magento cart price rules Sally
// maintains (rule IDs 88, 89, 92) so the POS can price a trade cart
// without a Magento round-trip. The rules are data, loaded from the
// `trade_discount_rules` setting and editable under Settings -> Trade
// Pricing; trade-rules.defaults.ts holds the seed/fallback set.
//
// Resolution rule per line:
//   - Pick the SINGLE highest matching auto discount (rules don't stack
//     with each other — matches Magento's stop_rules_processing default
//     for these rules)
//   - The cashier's manual line discount overrides the auto one ONLY if
//     it's higher; otherwise the auto value wins. So the trade customer
//     always gets at least their entitled discount.
const RULES_CACHE_TTL_MS = 60_000;

@Injectable()
export class TradeDiscountsService {
  constructor(
    @InjectRepository(Category)
    private readonly categoryRepository: Repository<Category>,
    private readonly settingsService: SettingsService,
  ) {}

  // Rules are read on every priced line, so cache them briefly rather
  // than hitting settings per product. An admin edit takes effect
  // within a minute without a restart.
  private rulesCache: { rules: TradeRule[]; loadedAt: number } | null = null;

  async getRules(): Promise<TradeRule[]> {
    const now = Date.now();
    if (this.rulesCache && now - this.rulesCache.loadedAt < RULES_CACHE_TTL_MS) {
      return this.rulesCache.rules;
    }
    let rules: TradeRule[];
    try {
      const stored = await this.settingsService.getValue<any>(
        'trade_discount_rules',
        null,
      );
      rules = normaliseTradeRules(stored);
    } catch {
      // Never let a settings hiccup strip a trade customer's discount.
      rules = DEFAULT_TRADE_RULES;
    }
    this.rulesCache = { rules, loadedAt: now };
    return rules;
  }

  // Called after an admin saves new rules so the next priced line picks
  // them up immediately instead of waiting out the TTL.
  invalidateRulesCache(): void {
    this.rulesCache = null;
    // Rules may target different category names now.
    this.nameSubtreeCache.clear();
  }

  // Cache: smart-home root id → set of itself + all descendant ids.
  // Categories rarely change so we just memoise the first lookup; a
  // fresh sync that adds children needs a backend restart to pick them
  // up (acceptable trade-off for this code path).
  private subtreeCache = new Map<number, Set<number>>();

  private async getSubtreeIds(rootId: number): Promise<Set<number>> {
    const cached = this.subtreeCache.get(rootId);
    if (cached) return cached;
    const all = await this.categoryRepository.find({
      select: ['id', 'parentId'],
    });
    const childrenByParent = new Map<number, number[]>();
    for (const c of all) {
      if (c.parentId == null) continue;
      if (!childrenByParent.has(c.parentId)) {
        childrenByParent.set(c.parentId, []);
      }
      childrenByParent.get(c.parentId)!.push(c.id);
    }
    const result = new Set<number>([rootId]);
    const queue = [rootId];
    while (queue.length > 0) {
      const id = queue.shift()!;
      const kids = childrenByParent.get(id) || [];
      for (const k of kids) {
        if (!result.has(k)) {
          result.add(k);
          queue.push(k);
        }
      }
    }
    this.subtreeCache.set(rootId, result);
    return result;
  }

  // Returns the percent (0-100) of the best-matching trade rule for
  // this product, plus a label so the caller can show it to the cashier
  // / log it. Returns 0 / null when no rule matches.
  // Cache: category NAME (lowercased) → union of subtree ids for every
  // category carrying that name. Same lifetime as subtreeCache.
  private nameSubtreeCache = new Map<string, Set<number>>();

  private async getSubtreeIdsByName(categoryName: string): Promise<Set<number>> {
    const key = categoryName.trim().toLowerCase();
    const cached = this.nameSubtreeCache.get(key);
    if (cached) return cached;
    const all = await this.categoryRepository.find({ select: ['id', 'name'] });
    const roots = all.filter(
      (c) => (c.name || '').trim().toLowerCase() === key,
    );
    const result = new Set<number>();
    for (const root of roots) {
      for (const id of await this.getSubtreeIds(root.id)) {
        result.add(id);
      }
    }
    this.nameSubtreeCache.set(key, result);
    return result;
  }

  // A product counts as clearance when any of its categories is named
  // like one ("Warehouse Clearance", "Clearance", "Sale").
  private isClearanceProduct(product: Product): boolean {
    return (product.categories || []).some((c) => {
      const n = (c.name || '').trim().toLowerCase();
      return /clearance/.test(n) || n === 'sale';
    });
  }

  async getAutoDiscount(product: Product): Promise<{
    percent: number;
    label: string | null;
    // The % applies to the sale-aware effective price instead of the
    // fixed retail RRP (ceiling-fans rule).
    baseOnSpecialPrice: boolean;
  }> {
    const NONE = { percent: 0, label: null, baseOnSpecialPrice: false };
    const rules = await this.getRules();
    const productCategoryIds = new Set<number>(
      (product.categories || []).map((c) => c.id),
    );
    const name = (product.name || '').trim().toLowerCase();

    // First enabled match WINS and terminates — mirrors Magento's
    // stop_rules_processing. Rule order is part of the configuration.
    for (const rule of rules) {
      if (!rule.enabled) continue;

      // Brand exclusion applies to every matchType. Whole-word prefix
      // so "Eglo" doesn't also exclude something like "Eglobe".
      const prefix = (rule.excludeNamePrefix || '').toLowerCase();
      const excludedByPrefix =
        !!prefix && new RegExp(`^${prefix}\\b`, 'i').test(name);

      let matches = false;
      switch (rule.matchType) {
        case 'category': {
          if (rule.categoryId == null) break;
          // Match the category itself OR anything beneath it, so naming
          // a parent catches its children without listing them all.
          const subtree = await this.getSubtreeIds(rule.categoryId);
          matches = [...productCategoryIds].some((id) => subtree.has(id));
          break;
        }
        case 'category_name': {
          if (!rule.categoryName) break;
          const subtree = await this.getSubtreeIdsByName(rule.categoryName);
          matches = [...productCategoryIds].some((id) => subtree.has(id));
          break;
        }
        case 'all_except_prefix':
          matches = true; // prefix handled below for all types
          break;
        case 'all':
          matches = true;
          break;
      }

      if (!matches || excludedByPrefix) {
        // Category rules with an excluded brand fall through to later
        // rules ONLY when the category itself didn't match; a brand
        // exclusion on a matching category rule means "no discount for
        // this brand here", but broader rules may still apply — except
        // they carry the same brand exclusions in practice, so simply
        // continue.
        continue;
      }

      // SALE / CLEARANCE carve-out: the item matched this rule but is
      // marked down already — no trade discount, and no falling through
      // to a broader (bigger) rule either.
      if (rule.excludeClearance && this.isClearanceProduct(product)) {
        return NONE;
      }

      return {
        percent: rule.percent,
        label: rule.label,
        baseOnSpecialPrice: rule.baseOnSpecialPrice === true,
      };
    }
    return NONE;
  }
}
