// Declarative trade auto-discount rules, mirroring the Magento cart
// price rules Sally maintains (rule IDs 88, 89, 92).
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
//                         starts with excludeNamePrefix (how Eglo is
//                         excluded — those products have no synced brand
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

export const SMART_HOME_ROOT_CATEGORY_ID = 24; // pos.categories.id
export const LED_ALU_PROFILE_CATEGORY_ID = 92; // pos.categories.id

// Order matters — first enabled match wins. Ceiling Fans must sit above
// the 20%-all rule or fans would never reach their 15%; the 20%-all rule
// must sit above the two 10% rules so non-Eglo smart-home / LED-profile
// products keep getting 20% (as they did under the old highest-wins
// resolution).
export const DEFAULT_TRADE_RULES: TradeRule[] = [
  {
    id: 93,
    label: '15% off Ceiling Fans on special price (TRADE)',
    percent: 15,
    matchType: 'category_name',
    categoryId: null,
    categoryName: 'Ceiling Fans',
    // Fans previously got their 20% via the minus-Eglo rule, so keep
    // Eglo excluded here too — otherwise Eglo fans would gain a
    // discount they never had.
    excludeNamePrefix: 'eglo',
    baseOnSpecialPrice: true,
    excludeClearance: true,
    enabled: true,
  },
  {
    id: 92,
    label: '20% off all lighting minus Eglo (TRADE)',
    percent: 20,
    matchType: 'all_except_prefix',
    categoryId: null,
    excludeNamePrefix: 'eglo',
    enabled: true,
  },
  {
    id: 88,
    label: '10% off Smart Home (TRADE)',
    percent: 10,
    matchType: 'category',
    categoryId: SMART_HOME_ROOT_CATEGORY_ID,
    excludeNamePrefix: null,
    enabled: true,
  },
  {
    id: 89,
    label: '10% off LED Aluminium Profile (TRADE)',
    percent: 10,
    matchType: 'category',
    categoryId: LED_ALU_PROFILE_CATEGORY_ID,
    excludeNamePrefix: null,
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
