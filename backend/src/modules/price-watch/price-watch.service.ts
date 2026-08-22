import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import axios from 'axios';
import { SupplierCost } from './entities/supplier-cost.entity';
import { ScrapeRun, ScrapeRunStatus } from './entities/scrape-run.entity';
import { CompetitorPriceSnapshot } from './entities/competitor-price.entity';
import { Product } from '../products/entities/product.entity';
import {
  CompetitorIndex,
  cfdBuildIndex,
  headlessIndex,
  joinedAlnum,
  jsonLdPrice,
  olBuildIndex,
  olScrapePrice,
  promisePool,
  shopifyIndex,
  slugFindUrl,
  SlugIndex,
  wooIndex,
} from './price-watch.fetchers';

export const COMPETITORS = [
  'onlinelighting',
  'bestbuylighting',
  'lights4less',
  'lightingillusions',
  'ceilingfansdirect',
  'ceilingfanswarehouse',
] as const;
export type CompetitorName = (typeof COMPETITORS)[number];

export type Verdict = 'cheaper' | 'costlier' | 'same' | 'no_competitor' | 'not_in_pos';

export interface DashboardRow {
  supplier: string;
  sku: string;
  name: string | null;
  costIncGst: number;
  posPrice: number | null;
  competitors: Partial<
    Record<CompetitorName, { price: number; url: string | null; prevPrice: number | null }>
  >;
  minCompetitor: number | null;
  verdict: Verdict;
  // Biggest absolute week-on-week competitor move on this row (0 = none).
  maxMove: number;
}

interface DashboardModel {
  rows: DashboardRow[];
  lastRun: { id: number; finishedAt: Date; stats: any } | null;
  prevRun: { id: number; finishedAt: Date } | null;
}

const norm = (s: unknown): string => String(s ?? '').trim().toLowerCase();

// POS is "same" as a competitor within ±1% — 5c differences shouldn't
// scream cheaper/costlier at Sally.
const SAME_BAND = 0.01;

@Injectable()
export class PriceWatchService {
  private readonly logger = new Logger(PriceWatchService.name);
  private running = false;
  private model: DashboardModel | null = null;
  private modelBuiltAt = 0;
  private readonly MODEL_TTL = 10 * 60 * 1000;

  constructor(
    @InjectRepository(SupplierCost)
    private readonly supplierCostRepo: Repository<SupplierCost>,
    @InjectRepository(ScrapeRun)
    private readonly runRepo: Repository<ScrapeRun>,
    @InjectRepository(CompetitorPriceSnapshot)
    private readonly snapshotRepo: Repository<CompetitorPriceSnapshot>,
    @InjectRepository(Product)
    private readonly productRepo: Repository<Product>,
  ) {}

  // Sunday 18:00 UTC = Monday 4am Melbourne (AEST). Data is fresh when
  // Sally opens the dashboard Monday morning; sites are quiet.
  @Cron('0 18 * * 0')
  async weeklyScrape(): Promise<void> {
    try {
      await this.runScrape('weekly cron');
    } catch (err: any) {
      this.logger.error(`Weekly scrape failed: ${err?.message}`);
    }
  }

  isRunning(): boolean {
    return this.running;
  }

  async runScrape(trigger: string): Promise<{ runId: number }> {
    if (this.running) {
      throw new Error('A scrape run is already in progress');
    }
    this.running = true;
    const run = await this.runRepo.save(this.runRepo.create({}));
    const t0 = Date.now();
    this.logger.log(`Scrape run ${run.id} started (${trigger})`);
    try {
      const skus = (
        await this.supplierCostRepo
          .createQueryBuilder('sc')
          .select('DISTINCT sc.sku', 'sku')
          .getRawMany()
      ).map((r) => String(r.sku));
      this.logger.log(`${skus.length} distinct supplier SKUs to price`);

      const perCompetitor: Record<string, number> = {};
      const snapshots: Array<Partial<CompetitorPriceSnapshot>> = [];

      const indexed: Array<[CompetitorName, CompetitorIndex]> = [
        ['bestbuylighting', await shopifyIndex('bestbuylighting', 'https://www.bestbuylighting.com.au')],
        ['lights4less', await shopifyIndex('lights4less', 'https://lights4less.com.au')],
        [
          'lightingillusions',
          await headlessIndex(
            'lightingillusions',
            'https://www.lightingillusions.com.au',
            'https://backend.lightingillusions.com.au',
          ),
        ],
        ['ceilingfanswarehouse', await wooIndex('ceilingfanswarehouse', 'https://www.ceilingfanswarehouse.com.au')],
      ];

      for (const [label, idx] of indexed) {
        let n = 0;
        for (const sku of skus) {
          const hit = idx.get(norm(sku)) ?? idx.get(joinedAlnum(sku));
          if (hit) {
            snapshots.push({ runId: run.id, sku, competitor: label, price: hit.price, url: hit.url });
            n++;
          }
        }
        perCompetitor[label] = n;
      }

      // onlinelighting + ceilingfansdirect: sitemap slug match, then
      // scrape each matched page once (OL: CS-Cart selectors + JSON-LD;
      // CFD: JSON-LD only — its category API is broken).
      const slugSites: Array<{
        label: CompetitorName;
        idx: SlugIndex;
        scrape: (url: string) => Promise<number | null>;
      }> = [
        { label: 'onlinelighting', idx: await olBuildIndex(), scrape: olScrapePrice },
        { label: 'ceilingfansdirect', idx: await cfdBuildIndex(), scrape: jsonLdPrice },
      ];
      for (const { label, idx, scrape } of slugSites) {
        const urlBySku = new Map<string, string>();
        for (const sku of skus) {
          const url = slugFindUrl(sku, idx);
          if (url) urlBySku.set(sku, url);
        }
        const uniqueUrls = [...new Set(urlBySku.values())];
        this.logger.log(`${label}: ${urlBySku.size} SKU matches, ${uniqueUrls.length} pages to scrape`);
        const priceByUrl = new Map<string, number | null>();
        await promisePool(
          uniqueUrls,
          async (url) => {
            priceByUrl.set(url, await scrape(url));
          },
          6,
        );
        let n = 0;
        for (const [sku, url] of urlBySku) {
          const price = priceByUrl.get(url);
          if (price != null && price > 0) {
            snapshots.push({ runId: run.id, sku, competitor: label, price, url });
            n++;
          }
        }
        perCompetitor[label] = n;
      }

      for (let i = 0; i < snapshots.length; i += 500) {
        await this.snapshotRepo.insert(snapshots.slice(i, i + 500) as any);
      }

      const durationS = Math.round((Date.now() - t0) / 1000);
      run.status = ScrapeRunStatus.DONE;
      run.finishedAt = new Date();
      run.stats = JSON.stringify({ perCompetitor, totalPrices: snapshots.length, durationS });
      await this.runRepo.save(run);
      this.model = null;
      this.logger.log(
        `Scrape run ${run.id} done in ${durationS}s: ${snapshots.length} prices (${JSON.stringify(perCompetitor)})`,
      );
      await this.slackPing(
        `✅ Weekly price scrape done in ${Math.round(durationS / 60)}min — ` +
          `${snapshots.length} prices: ` +
          COMPETITORS.map((c) => `${c} ${perCompetitor[c] ?? 0}`).join(', '),
      );
      return { runId: run.id };
    } catch (err: any) {
      run.status = ScrapeRunStatus.FAILED;
      run.finishedAt = new Date();
      run.error = String(err?.message ?? err);
      await this.runRepo.save(run);
      await this.slackPing(`❌ Weekly price scrape FAILED: ${run.error}`);
      throw err;
    } finally {
      this.running = false;
    }
  }

  private async slackPing(text: string): Promise<void> {
    const webhook = process.env.SLACK_WEBHOOK_URL;
    if (!webhook) return;
    try {
      await axios.post(webhook, { text }, { timeout: 10000 });
    } catch (err: any) {
      this.logger.warn(`Slack ping failed: ${err?.message}`);
    }
  }

  // ---------- dashboard queries ----------

  private async getModel(): Promise<DashboardModel> {
    if (this.model && Date.now() - this.modelBuiltAt < this.MODEL_TTL) {
      return this.model;
    }
    const runs = await this.runRepo.find({
      where: { status: ScrapeRunStatus.DONE },
      order: { id: 'DESC' },
      take: 2,
    });
    const [last, prev] = runs;

    const latestBySkuComp = new Map<string, { price: number; url: string | null }>();
    const prevBySkuComp = new Map<string, number>();
    if (last) {
      for (const s of await this.snapshotRepo.find({ where: { runId: last.id } })) {
        latestBySkuComp.set(`${norm(s.sku)}|${s.competitor}`, {
          price: Number(s.price),
          url: s.url,
        });
      }
    }
    if (prev) {
      for (const s of await this.snapshotRepo.find({ where: { runId: prev.id } })) {
        prevBySkuComp.set(`${norm(s.sku)}|${s.competitor}`, Number(s.price));
      }
    }

    const products = await this.productRepo
      .createQueryBuilder('p')
      .select(['p.sku', 'p.name', 'p.price', 'p.specialPrice', 'p.specialPriceFrom', 'p.specialPriceTo'])
      .getMany();
    const posBySku = new Map<string, { name: string; price: number }>();
    const now = new Date();
    for (const p of products) {
      const sp = p.specialPrice != null ? Number(p.specialPrice) : null;
      const inWindow =
        sp != null &&
        (!p.specialPriceFrom || new Date(p.specialPriceFrom) <= now) &&
        (!p.specialPriceTo || new Date(p.specialPriceTo) >= now);
      posBySku.set(norm(p.sku), {
        name: p.name,
        price: inWindow && sp != null ? sp : Number(p.price),
      });
    }

    const costs = await this.supplierCostRepo.find();
    const rows: DashboardRow[] = costs.map((c) => {
      const k = norm(c.sku);
      const pos = posBySku.get(k);
      const competitors: DashboardRow['competitors'] = {};
      let minComp: number | null = null;
      let maxMove = 0;
      for (const comp of COMPETITORS) {
        const hit = latestBySkuComp.get(`${k}|${comp}`);
        if (!hit) continue;
        const prevPrice = prevBySkuComp.get(`${k}|${comp}`) ?? null;
        competitors[comp] = { price: hit.price, url: hit.url, prevPrice };
        if (minComp === null || hit.price < minComp) minComp = hit.price;
        if (prevPrice != null) {
          maxMove = Math.max(maxMove, Math.abs(hit.price - prevPrice));
        }
      }
      let verdict: Verdict;
      if (!pos) verdict = 'not_in_pos';
      else if (minComp === null) verdict = 'no_competitor';
      else if (pos.price < minComp * (1 - SAME_BAND)) verdict = 'cheaper';
      else if (pos.price > minComp * (1 + SAME_BAND)) verdict = 'costlier';
      else verdict = 'same';
      return {
        supplier: c.supplier,
        sku: c.sku,
        name: pos?.name ?? null,
        costIncGst: Number(c.costIncGst),
        posPrice: pos?.price ?? null,
        competitors,
        minCompetitor: minComp,
        verdict,
        maxMove: Math.round(maxMove * 100) / 100,
      };
    });

    this.model = {
      rows,
      lastRun: last
        ? { id: last.id, finishedAt: last.finishedAt!, stats: JSON.parse(last.stats || '{}') }
        : null,
      prevRun: prev ? { id: prev.id, finishedAt: prev.finishedAt! } : null,
    };
    this.modelBuiltAt = Date.now();
    return this.model;
  }

  async getSummary() {
    const model = await this.getModel();
    // Cards count DISTINCT products (a sku on two supplier sheets is
    // still one product on the shelf).
    const bySku = new Map<string, DashboardRow>();
    for (const r of model.rows) {
      if (!bySku.has(norm(r.sku))) bySku.set(norm(r.sku), r);
    }
    const cards = { cheaper: 0, costlier: 0, same: 0, no_competitor: 0, not_in_pos: 0 };
    for (const r of bySku.values()) cards[r.verdict]++;
    const suppliers = [...new Set(model.rows.map((r) => r.supplier))].sort();
    return {
      cards,
      totalSkus: bySku.size,
      suppliers,
      competitors: COMPETITORS,
      lastRun: model.lastRun,
      prevRun: model.prevRun,
      scrapeRunning: this.running,
    };
  }

  async getRows(q: {
    search?: string;
    supplier?: string;
    competitor?: string;
    verdict?: string;
    moversOnly?: boolean;
    page: number;
    limit: number;
  }) {
    const model = await this.getModel();
    let rows = model.rows;
    if (q.supplier) rows = rows.filter((r) => r.supplier === q.supplier);
    if (q.verdict) rows = rows.filter((r) => r.verdict === q.verdict);
    if (q.competitor) rows = rows.filter((r) => (r.competitors as any)[q.competitor!]);
    if (q.moversOnly) rows = rows.filter((r) => r.maxMove > 0);
    if (q.search) {
      const s = q.search.trim().toLowerCase();
      rows = rows.filter(
        (r) => r.sku.toLowerCase().includes(s) || (r.name ?? '').toLowerCase().includes(s),
      );
    }
    const total = rows.length;
    const start = (q.page - 1) * q.limit;
    return { total, page: q.page, limit: q.limit, rows: rows.slice(start, start + q.limit) };
  }

  async exportCsv(q: {
    search?: string;
    supplier?: string;
    competitor?: string;
    verdict?: string;
    moversOnly?: boolean;
  }): Promise<string> {
    const { rows } = await this.getRows({ ...q, page: 1, limit: Number.MAX_SAFE_INTEGER });
    const esc = (v: unknown) => {
      const s = String(v ?? '');
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const header = [
      'supplier',
      'sku',
      'name',
      'cost_inc_gst',
      'pos_price',
      'verdict',
      ...COMPETITORS.flatMap((c) => [`${c}_price`, `${c}_last_week`, `${c}_url`]),
    ];
    const lines = [header.join(',')];
    for (const r of rows) {
      lines.push(
        [
          esc(r.supplier),
          esc(r.sku),
          esc(r.name),
          r.costIncGst,
          r.posPrice ?? '',
          r.verdict,
          ...COMPETITORS.flatMap((c) => {
            const hit = r.competitors[c];
            return [hit?.price ?? '', hit?.prevPrice ?? '', esc(hit?.url ?? '')];
          }),
        ].join(','),
      );
    }
    return lines.join('\n');
  }
}
