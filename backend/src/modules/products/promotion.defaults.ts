// Store-wide promotion applied automatically at checkout. First the fan
// promotion (Avi / Sally, 7 Oct 2026: "for all fans apply 10% at
// checkout, excluding the ones already on sale, clearance and Iconic"),
// now Black Friday (Sally, 1 Nov 2026). Stored as JSON in the
// `fan_promotion` setting and edited under Settings -> Trade Pricing.
//
// Unlike the trade rules it applies to EVERY customer. A trade customer
// gets whichever is better, the trade rate or the promotion.
export interface Promotion {
  enabled: boolean;
  label: string;
  percent: number;
  // Exact category names (case-insensitive); each includes its whole
  // subtree. Names, not ids, so a category re-sync can't break it.
  includeCategories: string[];
  excludeCategories: string[];
  // Product name (whole word) or SKU (plain prefix) starting with any of
  // these is excluded — how the Iconic Fan Company range is identified,
  // since its brand category in Magento has no products in it.
  excludePrefixes: string[];
  // Leave out anything already on sale (special price, or a Sale /
  // Clearance category). Off for Black Friday: Magento's rule takes its %
  // off the special price too and leaves out only the Sale / Clearance
  // categories, which excludeCategories names.
  excludeOnSale: boolean;
  // Last day of the promotion (YYYY-MM-DD, store time), or null for
  // open-ended.
  endsOn: string | null;
  // From this store time ("YYYY-MM-DD HH:mm") nothing comes off at
  // checkout but the banner keeps running — for when the sale prices come
  // from Magento as special prices. Null = the % applies throughout.
  discountUntil: string | null;
  // Red strip across the top of the POS while the promotion runs.
  // {percent} in the text is replaced with the discount.
  showBanner: boolean;
  bannerText: string;
}

export const PROMOTION_SETTING_KEY = 'fan_promotion';

// Black Friday 2026, mirroring Magento cart rule 113 "Black Friday SALE
// 2026": 15% at checkout on the whole range except Sale, Warehouse
// Clearance, the fans sale category and the Eglo, Iconic, Trend, IXL and
// Brightgreen brand categories. The Magento fans sale category is "SALE -
// 40% Off Ceiling Fans"; the POS still has its old name, so both are
// listed. Brand products missing from their brand category (64 Eglo, 12
// IXL, 15 Iconic fans on 1 Nov) are caught by name.
export const DEFAULT_PROMOTION: Promotion = {
  enabled: true,
  label: 'Black Friday',
  percent: 15,
  includeCategories: ['Indoor', 'Outdoor', 'LED', 'Globes', 'Fans', 'Exhausts Fans', 'Smart Home', 'Brands'],
  excludeCategories: [
    'Sale',
    'Warehouse Clearance',
    'SALE - 40% Off Ceiling Fans',
    'SALE - Up to 40% of Fans',
    'Eglo',
    'Eglo Ceiling Fans - Major Supplier',
    'Iconic',
    'Trend',
    'Trend Lighting',
    'IXL Appliances',
    'Brightgreen',
  ],
  excludePrefixes: ['Eglo', 'Iconic', 'Artemis', 'Sycamore', 'Trend', 'IXL'],
  excludeOnSale: false,
  endsOn: null,
  // Darshan puts the Black Friday prices on the products in Magento
  // tonight; the 00:30 product sync brings them across, so the POS stops
  // taking its own % then (Avi, 1 Nov 2026).
  discountUntil: '2026-11-02 00:30',
  showBanner: true,
  bannerText:
    'BLACK FRIDAY SALE NOW ON — Black Friday prices are already on the products · Excludes Sale & Clearance items, Eglo, Iconic, Trend and IXL',
};

const list = (v: unknown, fallback: string[]): string[] => {
  if (Array.isArray(v)) {
    return v.map((x) => String(x ?? '').trim()).filter(Boolean).slice(0, 50);
  }
  if (typeof v === 'string') {
    return v.split(',').map((x) => x.trim()).filter(Boolean).slice(0, 50);
  }
  return fallback;
};

export function normalisePromotion(raw: unknown): Promotion {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const pct = Number(r.percent);
  const ends = typeof r.endsOn === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.endsOn.trim())
    ? r.endsOn.trim()
    : null;
  return {
    enabled: r.enabled === undefined ? DEFAULT_PROMOTION.enabled : r.enabled === true,
    label: (typeof r.label === 'string' && r.label.trim()) ? r.label.trim().slice(0, 60) : DEFAULT_PROMOTION.label,
    percent: Number.isFinite(pct) && pct > 0 && pct <= 90 ? Math.round(pct * 100) / 100 : DEFAULT_PROMOTION.percent,
    includeCategories: list(r.includeCategories, DEFAULT_PROMOTION.includeCategories),
    excludeCategories: list(r.excludeCategories, DEFAULT_PROMOTION.excludeCategories),
    excludePrefixes: list(r.excludePrefixes, DEFAULT_PROMOTION.excludePrefixes),
    excludeOnSale:
      r.excludeOnSale === undefined ? DEFAULT_PROMOTION.excludeOnSale : r.excludeOnSale === true,
    endsOn: ends,
    discountUntil:
      r.discountUntil === undefined
        ? DEFAULT_PROMOTION.discountUntil
        : typeof r.discountUntil === 'string' && /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}$/.test(r.discountUntil.trim())
          ? r.discountUntil.trim().replace('T', ' ')
          : null,
    showBanner: r.showBanner === undefined ? DEFAULT_PROMOTION.showBanner : r.showBanner === true,
    bannerText:
      typeof r.bannerText === 'string' && r.bannerText.trim()
        ? r.bannerText.trim().slice(0, 300)
        : DEFAULT_PROMOTION.bannerText,
  };
}
