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
        for (const k of [norm(v.sku), norm(String(v.sku ?? '').replace(PREFIX_RE, ''))]) {
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
        for (const k of [norm(p.model), norm(p.modelRaw), norm(p.sku)]) {
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
export async function wooIndex(label: string, base: string): Promise<CompetitorIndex> {
  const out: CompetitorIndex = new Map();
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
      const sku = norm(p.sku);
      const prices = p.prices ?? {};
      const minor = parseInt(prices.currency_minor_unit ?? '2', 10);
      const val = parseFloat(prices.price ?? '') / Math.pow(10, minor);
      if (sku && Number.isFinite(val) && val > 0 && !out.has(sku)) {
        out.set(sku, { price: Math.round(val * 100) / 100, url: p.permalink ?? '' });
      }
    }
    const totalPages = parseInt(r.headers?.['x-wp-totalpages'] ?? '0', 10);
    if (totalPages && page >= totalPages) break;
    await sleep(200);
  }
  logger.log(`${label}: ${out.size} skus`);
  return out;
}

// ---------- onlinelighting (sitemap token match + page scrape) ----------
// Same exact-token matching as Price_scraper/scrape_competitor_prices.py:
// only SKU-looking tokens, ambiguity-guarded, no name fuzz.

export interface OlIndex {
  firstUrl: Map<string, string>;
  count: Map<string, number>;
}

export async function olBuildIndex(): Promise<OlIndex> {
  const xml = (await getWithRetry('https://onlinelighting.com.au/sitemap.xml', 3, 60000))
    .data as string;
  const firstUrl = new Map<string, string>();
  const count = new Map<string, number>();
  let products = 0;
  for (const m of xml.matchAll(
    /<loc>(https:\/\/onlinelighting\.com\.au\/([^<]*\.html))<\/loc>/g,
  )) {
    products++;
    const url = m[1];
    const tokens = new Set(m[2].replace('.html', '').toLowerCase().split('-').filter(Boolean));
    for (const t of tokens) {
      if (!firstUrl.has(t)) firstUrl.set(t, url);
      count.set(t, (count.get(t) ?? 0) + 1);
    }
  }
  logger.log(`onlinelighting: ${products} products indexed`);
  return { firstUrl, count };
}

// Identifying model tokens from a supplier SKU: >=5 chars with a digit,
// or pure digits >=4. Longest first — the real model number.
function strongSkuTokens(sku: string): string[] {
  const parts = String(sku).trim().toLowerCase().split(/[^a-z0-9]+/);
  const out = new Set<string>();
  for (const p of parts) {
    if (!p) continue;
    const hasDigit = /\d/.test(p);
    if ((p.length >= 5 && hasDigit) || (/^\d+$/.test(p) && p.length >= 4)) out.add(p);
  }
  return [...out].sort((a, b) => b.length - a.length);
}

export function olFindUrl(sku: string, idx: OlIndex, maxAmbiguity = 6): string | null {
  for (const tok of strongSkuTokens(sku)) {
    const url = idx.firstUrl.get(tok);
    if (url && (idx.count.get(tok) ?? 0) <= maxAmbiguity) return url;
  }
  return null;
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
