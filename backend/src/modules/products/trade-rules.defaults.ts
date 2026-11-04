// Declarative trade auto-discount rules, mirroring the Magento cart
// price rules Sally maintains (rule IDs 88, 89, 111, 112).
//
// These used to be closures compiled into the service, which meant a
// rate change needed a deploy. They're now data so they can live in the
// `trade_discount_rules` setting and be edited under Settings -> Trade
// Pricing (Sally: "In Administrator, can there be an area where the
// Trade Price can be adjusted / overruled by the rule").
//
// matchType semantics:
//   'category'          - product sits in categoryId, or anywhere in its
//                         subtree (so a parent id catches its children)
//   'category_name'     - same, but the category is found by NAME
//                         (case-insensitive) instead of id. Used for the
//                         Ceiling Fans rule so it survives category
//                         re-syncs where ids can shift.
//   'all_except_prefix' - whole catalogue except products whose NAME
//                         starts with excludeNamePrefix (how Eglo used to
//                         be excluded — products have no synced brand
//                         attribute, so the name is the only handle)
//   'all'               - every product
//
// Rules are evaluated IN ORDER and the first enabled match wins —
// mirroring Magento's stop_rules_processing. The default order below is
// arranged so outcomes for the original three rules are unchanged.
export type TradeRuleMatchType =
  | 'category'
  | 'category_name'
  | 'all_except_prefix'
  | 'all';

export interface TradeRule {
  id: number;
  label: string;
  percent: number;
  matchType: TradeRuleMatchType;
  categoryId?: number | null;
  categoryName?: string | null;
  excludeNamePrefix?: string | null;
  // Apply the % to the sale-aware effective price (special price when
  // active) instead of the fixed retail RRP. Sally's ceiling-fans spec:
  // "15% on 'Special Price'".
  baseOnSpecialPrice?: boolean;
  // Products in a SALE / CLEARANCE category get NO trade discount from
  // this rule — and the rule still terminates matching, so they don't
  // fall through to a broader rule either.
  excludeClearance?: boolean;
  enabled: boolean;
}

// Every trade % rule can be paused up to and including a day (store
// time) — Black Friday 2026: the sale prices end 7 Dec and trade
// customers get no trade % on top until then (Avi, 3 Nov 2026). They come
// back on by themselves the day after. The `trade_rules_paused_until`
// setting overrides this default; empty = not paused. A trade price set
// on a product itself still applies, and so does PAUSED_TRADE_LIGHTING.
export const TRADE_PAUSE_SETTING_KEY = 'trade_rules_paused_until';
export const DEFAULT_TRADE_RULES_PAUSED_UNTIL: string | null = '2026-12-07';

export function normalisePausedUntil(raw: unknown): string | null {
  return typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.trim()) ? raw.trim() : null;
}

// While the rules are paused, trade lighting still comes to exactly the
// lighting rule's 20% (Sally, 5 Nov 2026: trade lost 5% on lighting over
// Black Friday, "apply 5% more on top until Black Friday ends"; Avi:
// exactly 20). On a Black Friday price that is 20% off the regular price,
// so the sale's 15% counts towards it instead of stacking. Before the sale
// those products sold at today's regular price, so trade pays what it did
// in October. Lighting without a Black Friday price gets the rule as
// usual. Fans get nothing extra: the sale's 15% is their trade 15%. IXL and
// Sale / Clearance items get nothing.
export const PAUSED_TRADE_LIGHTING = {
  ruleId: 112,
  // Darshan's Black Friday special prices all end on this day.
  saleSpecialPriceTo: '2026-12-07',
  // Name prefix, or a category named after the brand ("IXL Appliances").
  excludeBrands: ['IXL'],
};

export const SMART_HOME_ROOT_CATEGORY_ID = 24; // pos.categories.id
export const LED_ALU_PROFILE_CATEGORY_ID = 92; // pos.categories.id

// Every rule applies its % to the special price when one is active,
// else to the regular price, and the cost + margin floor still applies
// (Sally, 8 Oct 2026: "Trade price needs to be 20% off the special
// price. If the special price isn't there then 20% of the Price should
// apply. And if the trade 20% discount is less than the margin, then
// the margin rule should apply").
//
// Eglo is no longer excluded (Sally, 29 Oct 2026: "Eglo shouldn't have a
// rule anymore ... 20% off lighting and 15% off fans", as Magento's rules
// 111 / 112 have done since 1 Oct). The old minus-Eglo rule 92 picked
// Eglo out by name, so Eglo products not named "Eglo ..." got trade and
// the rest didn't.
//
// Order matters — first enabled match wins. Ceiling Fans must sit above
// the 20%-all rule or fans would never reach their 15%. The 20%-all rule
// catches everything else, so the two 10% rules below it only apply if
// it is switched off under Settings -> Trade Pricing.
export const DEFAULT_TRADE_RULES: TradeRule[] = [
  {
    id: 111,
    label: '15% off Ceiling Fans on special price (TRADE)',
    percent: 15,
    matchType: 'category_name',
    categoryId: null,
    categoryName: 'Ceiling Fans',
    excludeNamePrefix: null,
    baseOnSpecialPrice: true,
    excludeClearance: true,
    enabled: true,
  },
  {
    id: 112,
    label: '20% off all lighting (TRADE)',
    percent: 20,
    matchType: 'all',
    categoryId: null,
    excludeNamePrefix: null,
    baseOnSpecialPrice: true,
    enabled: true,
  },
  {
    id: 88,
    label: '10% off Smart Home (TRADE)',
    percent: 10,
    matchType: 'category',
    categoryId: SMART_HOME_ROOT_CATEGORY_ID,
    excludeNamePrefix: null,
    baseOnSpecialPrice: true,
    enabled: true,
  },
  {
    id: 89,
    label: '10% off LED Aluminium Profile (TRADE)',
    percent: 10,
    matchType: 'category',
    categoryId: LED_ALU_PROFILE_CATEGORY_ID,
    excludeNamePrefix: null,
    baseOnSpecialPrice: true,
    enabled: true,
  },
];

// Coerce a stored/edited blob into usable rules. A malformed rule is
// dropped rather than allowed to throw mid-checkout; if nothing
// survives we fall back to the built-in set so trade customers never
// silently lose their entitled discount.
export function normaliseTradeRules(raw: unknown): TradeRule[] {
  if (!Array.isArray(raw) || raw.length === 0) return DEFAULT_TRADE_RULES;
  const cleaned: TradeRule[] = [];
  for (const [i, r] of (raw as any[]).entries()) {
    if (!r || typeof r !== 'object') continue;
    const percent = Number(r.percent);
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) continue;
    const matchType: TradeRuleMatchType =
      r.matchType === 'category' ||
      r.matchType === 'category_name' ||
      r.matchType === 'all_except_prefix' ||
      r.matchType === 'all'
        ? r.matchType
        : 'all';
    const categoryId =
      matchType === 'category' ? Number(r.categoryId) : null;
    const categoryName =
      matchType === 'category_name' && r.categoryName
        ? String(r.categoryName).trim()
        : null;
    // A category rule with no valid target would match nothing — drop
    // it rather than ship a dead rule.
    if (matchType === 'category' && !Number.isFinite(categoryId as number)) {
      continue;
    }
    if (matchType === 'category_name' && !categoryName) {
      continue;
    }
    cleaned.push({
      id: Number.isFinite(Number(r.id)) ? Number(r.id) : 1000 + i,
      label: String(r.label || `Trade rule ${i + 1}`).slice(0, 200),
      percent,
      matchType,
      categoryId: categoryId as number | null,
      categoryName,
      // The name-prefix exclusion applies to every matchType (the fans
      // rule is category-based but still excludes Eglo).
      excludeNamePrefix: r.excludeNamePrefix
        ? String(r.excludeNamePrefix).trim().toLowerCase()
        : null,
      baseOnSpecialPrice: r.baseOnSpecialPrice === true,
      excludeClearance: r.excludeClearance === true,
      enabled: r.enabled !== false,
    });
  }
  return cleaned.length > 0 ? cleaned : DEFAULT_TRADE_RULES;
}
