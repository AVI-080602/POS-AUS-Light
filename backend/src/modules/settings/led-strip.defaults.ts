// Cut-to-length LED strip catalogue. This is the seed/fallback list —
// the live values are stored in the `led_strip_products` setting (JSON)
// so an admin can edit rates without a deploy (Sally: "with the cost
// price of tail, could this be changed at the administrative level?").
export interface StripProduct {
  id: string;
  name: string;
  retailPerM: number;
  tradePerM: number;
  // Only cuttable at multiples of this many mm. 500 = 0.5m cuts, which
  // is the standard interval for strip lighting.
  cutMm: number;
  // Longest single continuous run (limited by voltage drop). Longer
  // orders warn the cashier but are never blocked — trade buy 100m+.
  maxRunM: number;
  // Metres of lead tail included free with each strip, and the
  // per-metre charge for anything above that.
  includedTailM: number;
  tailPerM: number;
}

export const DEFAULT_STRIP_PRODUCTS: StripProduct[] = [
  {
    id: 'hv240-ip67',
    name: 'High-Voltage Strip 240V — IP67 Outdoor',
    retailPerM: 46,
    tradePerM: 36,
    cutMm: 500,
    maxRunM: 50,
    includedTailM: 1,
    tailPerM: 7,
  },
  {
    id: 'lv24-ip65',
    name: 'Low-Voltage 24V — IP65 Outdoor',
    retailPerM: 28,
    tradePerM: 22,
    cutMm: 100,
    maxRunM: 10,
    includedTailM: 1,
    tailPerM: 6,
  },
  {
    id: 'lv12-ip20',
    name: 'Low-Voltage 12V — IP20 Indoor',
    retailPerM: 18,
    tradePerM: 14,
    cutMm: 50,
    maxRunM: 5,
    includedTailM: 1,
    tailPerM: 5,
  },
  {
    id: 'cob24-ip20',
    name: 'COB LED 24V — IP20 Indoor',
    retailPerM: 32,
    tradePerM: 25,
    cutMm: 50,
    maxRunM: 5,
    includedTailM: 1,
    tailPerM: 5,
  },
];

// Coerce whatever is stored in settings into a usable catalogue. Guards
// against a hand-edited JSON blob with missing/NaN fields taking the
// Strip Cut Counter down.
export function normaliseStripProducts(raw: unknown): StripProduct[] {
  if (!Array.isArray(raw) || raw.length === 0) return DEFAULT_STRIP_PRODUCTS;
  const num = (v: any, fallback: number): number => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  };
  const cleaned = raw
    .filter((p: any) => p && typeof p.id === 'string' && p.id.trim())
    .map((p: any, i: number): StripProduct => {
      const d = DEFAULT_STRIP_PRODUCTS[i] ?? DEFAULT_STRIP_PRODUCTS[0];
      return {
        id: String(p.id).trim(),
        name: String(p.name ?? d.name),
        retailPerM: num(p.retailPerM, d.retailPerM),
        tradePerM: num(p.tradePerM, d.tradePerM),
        // A zero cut interval would divide-by-zero in the calculator.
        cutMm: Math.max(1, num(p.cutMm, d.cutMm)),
        maxRunM: Math.max(1, num(p.maxRunM, d.maxRunM)),
        includedTailM: num(p.includedTailM, d.includedTailM),
        tailPerM: num(p.tailPerM, d.tailPerM),
      };
    });
  return cleaned.length > 0 ? cleaned : DEFAULT_STRIP_PRODUCTS;
}
