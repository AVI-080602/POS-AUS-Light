import axios from 'axios';
import * as cheerio from 'cheerio';
import { Logger } from '@nestjs/common';

// Competitor catalogue fetchers for the weekly price scrape. Direct
// ports of the proven Python scrapers in Price_scraper/ — same
// endpoints, same matching rules, same guards. All verified reachable
// from the VPS (vps_probe.py, 21 Aug 2026: no Cloudflare blocks).

const logger = new Logger('PriceWatchFetchers');

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const H_JSON = { 'User-Agent': UA, Accept: 'application/json' };

export interface CompetitorHit {
  price: number;
  url: string;
}

export type CompetitorIndex = Map<string, CompetitorHit>;

const norm = (s: unknown): string => String(s ?? '').trim().toLowerCase();
const PREFIX_RE = /^\d+-/;

// "CLA-352-WH" -> "cla352wh". Separator-insensitive join used on both
// sides of every match: supplier sheets, competitor skus and URL slugs
// all disagree about hyphens (found via CLA-352-WH, which lives on
// ceilingfansdirect only as slug tokens ...-cla-352-wh-34836).
export const joinedAlnum = (s: unknown): string =>
  String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// Bounded-concurrency promise pool for the onlinelighting page scrapes.
export async function promisePool<T, R>(
  items: T[],
  worker: (item: T) => Promise<R>,
  concurrency: number,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const lanes = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await worker(items[i]);
    }
  });
  await Promise.all(lanes);
  return results;
}

async function getWithRetry(url: string, attempts = 3, timeout = 60000) {
  let lastErr: unknown;
  for (let a = 0; a < attempts; a++) {
    try {
      return await axios.get(url, { headers: { 'User-Agent': UA }, timeout });
    } catch (err) {
      lastErr = err;
      await sleep(3000 * (a + 1));
    }
  }
  throw lastErr;
}

// ---------- Shopify (bestbuylighting, lights4less) ----------
// /products.json pagination; the platform 400s past page 100 — that is
// the end of what pagination can reach, not a failure.
export async function shopifyIndex(label: string, site: string): Promise<CompetitorIndex> {
  const out: CompetitorIndex = new Map();
  let consecEmpty = 0;
  for (let page = 1; page <= 100; page++) {
    let data: any[] | null = null;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const r = await axios.get(`${site}/products.json`, {
          params: { limit: 250, page },
          headers: H_JSON,
          timeout: 30000,
        });
        data = r.data?.products ?? [];
        break;
      } catch (err: any) {
        const status = err?.response?.status;
        if (status && ![429, 500, 502, 503, 504].includes(status)) {
          logger.warn(`shopify ${label} page ${page}: HTTP ${status}`);
          data = null;
          break;
        }
        await sleep(2000 * (attempt + 1));
      }
    }
    if (data === null) break;
    if (data.length === 0) {
      if (++consecEmpty >= 2) break;
      continue;
    }
    consecEmpty = 0;
    for (const p of data) {
      const url = `${site}/products/${p.handle}`;
      for (const v of p.variants ?? []) {
        const price = parseFloat(v.price);
        if (!Number.isFinite(price) || price <= 0) continue;
        for (const k of [
          norm(v.sku),
          norm(String(v.sku ?? '').replace(PREFIX_RE, '')),
          joinedAlnum(v.sku),
        ]) {
          if (k && !out.has(k)) out.set(k, { price, url });
        }
      }
    }
    if (data.length < 250) break;
    await sleep(150);
  }
  logger.log(`shopify ${label}: ${out.size} keys`);
  return out;
}

// ---------- Headless storefront (lightingillusions, ceilingfansdirect) ----------
// Category slugs from the sitemap, then the backend products/search API
// per category. Keys on model/modelRaw/sku — supplier SKUs are
// manufacturer model numbers on these sites.
export async function headlessIndex(
  label: string,
  front: string,
  backend: string,
): Promise<CompetitorIndex> {
  const sm = (await getWithRetry(`${front}/sitemap.xml`, 3, 90000)).data as string;
  const cats = [...new Set([...sm.matchAll(/\/category\/([a-z0-9-]+)/gi)].map((m) => m[1]))].sort();
  logger.log(`${label}: ${cats.length} categories`);
  const out: CompetitorIndex = new Map();
  for (const slug of cats) {
    for (let page = 1; ; page++) {
      let data: any[] | null = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          // siteId in BOTH query + body: lightingillusions reads the
          // body, ceilingfansdirect the query string.
          const r = await axios.post(
            `${backend}/api/products/search?siteId=1`,
            { siteId: 1, categorySlug: slug, page, perPage: 100 },
            { headers: { ...H_JSON, 'Content-Type': 'application/json' }, timeout: 90000 },
          );
          data = r.data?.data ?? [];
          break;
        } catch {
          await sleep(4000 * (attempt + 1));
        }
      }
      if (!data || data.length === 0) break;
      for (const p of data) {
        const sell = parseFloat(p.salePrice ?? '') || parseFloat(p.price ?? '');
        if (!Number.isFinite(sell) || sell <= 0) continue;
        const url = p.slug ? `${front}/product/${p.slug}` : '';
        const keys = [
          norm(p.model),
          norm(p.modelRaw),
          norm(p.sku),
          joinedAlnum(p.model),
          joinedAlnum(p.sku),
          // The slug often carries the manufacturer SKU as hyphenated
          // tokens the API fields don't have — index its token runs.
          ...slugRunKeys(String(p.slug ?? '')),
        ];
        for (const k of keys) {
          if (k && !out.has(k)) out.set(k, { price: sell, url });
        }
      }
      if (data.length < 100) break;
      await sleep(100);
    }
  }
  logger.log(`${label}: ${out.size} keys`);
  return out;
}

// ---------- WooCommerce Store API (ceilingfanswarehouse) ----------
// Their sku field is almost entirely internal codes (0 of our 30k
// supplier SKUs matched it, 23 Aug 2026) — but their /shop/ slugs
// sometimes carry the manufacturer code, so slug-run keys are indexed
// too (ambiguity-guarded, price straight from the same API row).
export async function wooIndex(label: string, base: string): Promise<CompetitorIndex> {
  const out: CompetitorIndex = new Map();
  const slugKeyed: Array<{ keys: string[]; hit: CompetitorHit }> = [];
  const keyCount = new Map<string, number>();
  for (let page = 1; ; page++) {
    let r: any = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        r = await axios.get(`${base}/wp-json/wc/store/v1/products`, {
          params: { per_page: 100, page },
          headers: H_JSON,
          timeout: 45000,
        });
        break;
      } catch {
        await sleep(3000 * (attempt + 1));
      }
    }
    if (!r) break;
    const data: any[] = r.data ?? [];
    if (data.length === 0) break;
    for (const p of data) {
      const prices = p.prices ?? {};
      const minor = parseInt(prices.currency_minor_unit ?? '2', 10);
      const val = parseFloat(prices.price ?? '') / Math.pow(10, minor);
      if (!Number.isFinite(val) || val <= 0) continue;
      const hit = { price: Math.round(val * 100) / 100, url: p.permalink ?? '' };
      for (const k of [norm(p.sku), joinedAlnum(p.sku)]) {
        if (k && !out.has(k)) out.set(k, hit);
      }
      const slugMatch = String(p.permalink ?? '').match(/\/shop\/([^/?#]+)/);
      if (slugMatch) {
        const keys = slugRunKeys(slugMatch[1]);
        slugKeyed.push({ keys, hit });
        for (const k of keys) keyCount.set(k, (keyCount.get(k) ?? 0) + 1);
      }
    }
    const totalPages = parseInt(r.headers?.['x-wp-totalpages'] ?? '0', 10);
    if (totalPages && page >= totalPages) break;
    await sleep(200);
  }
  // Slug keys go in second (sku keys win on collision), ambiguity <=6.
  for (const { keys, hit } of slugKeyed) {
    for (const k of keys) {
      if ((keyCount.get(k) ?? 99) <= 6 && !out.has(k)) out.set(k, hit);
    }
  }
  logger.log(`${label}: ${out.size} keys`);
  return out;
}

// ---------- slug token matching (onlinelighting, ceilingfansdirect) ----------
// Same exact-token matching as Price_scraper/scrape_competitor_prices.py
// (SKU-looking tokens only, ambiguity-guarded, no name fuzz), extended
// with joined CONSECUTIVE TOKEN RUNS so hyphenated SKUs match: slug
// "...-cla-352-wh-34836" indexes "cla352wh" and matches supplier SKU
// "CLA-352-WH" via its joined form.

export interface SlugIndex {
  firstUrl: Map<string, string>;
  count: Map<string, number>;
}

// Keys a slug contributes: each token, plus every joined run of 2–4
// consecutive tokens that contains a digit (SKUs always do) and is
// specific enough (>=6 chars) not to collide with word pairs.
export function slugRunKeys(slug: string): string[] {
  const tokens = slug.toLowerCase().split('-').filter(Boolean);
  const keys = new Set<string>(tokens);
  for (let i = 0; i < tokens.length; i++) {
    for (let len = 2; len <= 4 && i + len <= tokens.length; len++) {
      const run = tokens.slice(i, i + len).join('');
      if (run.length >= 6 && run.length <= 30 && /\d/.test(run)) keys.add(run);
    }
  }
  return [...keys];
}

function buildSlugIndex(entries: Array<{ url: string; slug: string }>): SlugIndex {
  const firstUrl = new Map<string, string>();
  const count = new Map<string, number>();
  for (const { url, slug } of entries) {
    for (const k of slugRunKeys(slug)) {
      if (!firstUrl.has(k)) firstUrl.set(k, url);
      count.set(k, (count.get(k) ?? 0) + 1);
    }
  }
  return { firstUrl, count };
}

export async function olBuildIndex(): Promise<SlugIndex> {
  const xml = (await getWithRetry('https://onlinelighting.com.au/sitemap.xml', 3, 60000))
    .data as string;
  const entries: Array<{ url: string; slug: string }> = [];
  for (const m of xml.matchAll(
    /<loc>(https:\/\/onlinelighting\.com\.au\/([^<]*)\.html)<\/loc>/g,
  )) {
    entries.push({ url: m[1], slug: m[2] });
  }
  logger.log(`onlinelighting: ${entries.length} products indexed`);
  return buildSlugIndex(entries);
}

// ceilingfansdirect's category API is broken (returns 0 products for
// real categories, 22 Aug 2026) but its sitemap lists every product and
// the pages are SSR'd with a JSON-LD price — so it gets the same
// slug-match + page-scrape treatment as onlinelighting.
export async function cfdBuildIndex(): Promise<SlugIndex> {
  const xml = (
    await getWithRetry('https://www.ceilingfansdirect.com.au/sitemap.xml', 3, 90000)
  ).data as string;
  const entries: Array<{ url: string; slug: string }> = [];
  for (const m of xml.matchAll(
    /<loc>(https?:\/\/[^<]*ceilingfansdirect\.com\.au\/product\/([^<\/]+))<\/loc>/g,
  )) {
    entries.push({ url: m[1], slug: m[2] });
  }
  logger.log(`ceilingfansdirect: ${entries.length} products indexed from sitemap`);
  return buildSlugIndex(entries);
}

// Spec tokens masquerading as model numbers: colour temps (3000k),
// wattages (16w), voltages (240v), lengths (1300mm), IP ratings —
// descriptive supplier "SKUs" like "Globes 6W E27 3000K" are full of
// them and they false-match accessory pages (found via a CFW light kit
// matching every 3000K globe).
const SPEC_TOKEN = /^(?:\d{1,4}(?:k|w|v|va|lm|ma|mm|cm|hz)|ip\d{2})$/;
const SPEC_NUMBERS = new Set(['2700', '3000', '4000', '5000', '5500', '6000', '6500']);

// Identifying tokens from a supplier SKU: >=5 chars with a digit, pure
// digits >=4, plus the joined-alnum whole SKU (catches short-token SKUs
// like CLA-352-WH). Longest first — the most specific key wins.
function strongSkuTokens(sku: string): string[] {
  const parts = String(sku).trim().toLowerCase().split(/[^a-z0-9]+/);
  const out = new Set<string>();
  for (const p of parts) {
    if (!p || SPEC_TOKEN.test(p) || SPEC_NUMBERS.has(p)) continue;
    const hasDigit = /\d/.test(p);
    if ((p.length >= 5 && hasDigit) || (/^\d+$/.test(p) && p.length >= 4)) out.add(p);
  }
  const joined = joinedAlnum(sku);
  if (joined.length >= 6 && /\d/.test(joined)) out.add(joined);
  return [...out].sort((a, b) => b.length - a.length);
}

export function slugFindUrl(sku: string, idx: SlugIndex, maxAmbiguity = 6): string | null {
  for (const tok of strongSkuTokens(sku)) {
    const url = idx.firstUrl.get(tok);
    if (url && (idx.count.get(tok) ?? 0) <= maxAmbiguity) return url;
  }
  return null;
}

// JSON-LD-only price extraction for SSR'd headless pages
// (ceilingfansdirect / lightingillusions product pages).
export async function jsonLdPrice(url: string): Promise<number | null> {
  try {
    const { data } = await axios.get(url, {
      headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml' },
      timeout: 25000,
    });
    const $ = cheerio.load(data);
    let price: number | null = null;
    $('script[type="application/ld+json"]').each((_, el) => {
      if (price) return;
      try {
        const j = JSON.parse($(el).html() || '');
        const offers = Array.isArray(j?.offers) ? j.offers[0] : j?.offers;
        const raw = offers?.price ?? (j?.['@type'] === 'Product' ? j?.price : undefined);
        if (j?.['@type'] === 'Product' && raw != null) {
          const p = parseFloat(raw);
          if (Number.isFinite(p) && p > 0) price = p;
        }
      } catch {
        /* ignore */
      }
    });
    return price;
  } catch {
    return null;
  }
}

// CS-Cart product page price extraction (same selector list as the POS
// CompetitorService + the Python scraper).
const OL_SELECTORS = [
  '.product-price-actual',
  '.price-discounted.ty-price',
  '.ty-price-num',
  '.price-wrapper .price',
  '.product-info-price .price',
  '.special-price .price',
  '.normal-price .price',
  'span.price',
  '[data-price-amount]',
  '.price-box .price',
];

export async function olScrapePrice(url: string): Promise<number | null> {
  try {
    const { data } = await axios.get(url, {
      headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml' },
      timeout: 25000,
    });
    const $ = cheerio.load(data);
    for (const sel of OL_SELECTORS) {
      const el = $(sel).first();
      if (!el.length) continue;
      const dp = el.attr('data-price-amount');
      if (dp) {
        const p = parseFloat(dp);
        if (Number.isFinite(p) && p > 0) return p;
      }
      const m = (el.text() || '').trim().match(/\$?\s?([\d,]+\.?\d*)/);
      if (m) {
        const p = parseFloat(m[1].replace(/,/g, ''));
        if (Number.isFinite(p) && p > 0) return p;
      }
    }
    let ldPrice: number | null = null;
    $('script[type="application/ld+json"]').each((_, el) => {
      if (ldPrice) return;
      try {
        const j = JSON.parse($(el).html() || '');
        const offers = Array.isArray(j?.offers) ? j.offers[0] : j?.offers;
        if (j?.['@type'] === 'Product' && offers?.price) {
          const p = parseFloat(offers.price);
          if (Number.isFinite(p) && p > 0) ldPrice = p;
        }
      } catch {
        /* ignore */
      }
    });
    return ldPrice;
  } catch {
    return null;
  }
}
