import { useCallback, useEffect, useState } from 'react';
import {
  ArrowDownTrayIcon,
  ArrowPathIcon,
  ExclamationTriangleIcon,
  MagnifyingGlassIcon,
} from '@heroicons/react/24/outline';
import { priceWatchApi, PriceWatchFilters } from '../../services/api';

// Admin-only competitor price dashboard. Data comes from the weekly
// scrape (Sunday night cron) — Sally only ever reads here; there is
// deliberately no refresh button in the UI.

const COMPETITOR_LABELS: Record<string, string> = {
  onlinelighting: 'Online Lighting',
  bestbuylighting: 'Best Buy',
  lights4less: 'Lights4Less',
  lightingillusions: 'Lighting Illusions',
  ceilingfansdirect: 'CF Direct',
  ceilingfanswarehouse: 'CF Warehouse',
};

interface Summary {
  cards: Record<string, number>;
  totalSkus: number;
  suppliers: string[];
  categories: string[];
  competitors: string[];
  lastRun: { id: number; finishedAt: string; stats: any } | null;
  prevRun: { id: number; finishedAt: string } | null;
  scrapeRunning: boolean;
}

interface Row {
  supplier: string;
  sku: string;
  name: string | null;
  costIncGst: number;
  posPrice: number | null;
  competitors: Record<string, { price: number; url: string | null; prevPrice: number | null }>;
  minCompetitor: number | null;
  verdict: string;
  maxMove: number;
}

const money = (n: number | null | undefined) =>
  n == null
    ? '—'
    : n.toLocaleString('en-AU', { style: 'currency', currency: 'AUD', minimumFractionDigits: 2 });

const CARD_DEFS: Array<{ key: string; label: string; tone: string }> = [
  { key: 'cheaper', label: 'POS cheaper', tone: 'text-green-400 border-green-500/40' },
  { key: 'costlier', label: 'POS costlier', tone: 'text-red-400 border-red-500/40' },
  { key: 'same', label: 'Same (±1%)', tone: 'text-gray-200 border-gray-500/40' },
  { key: 'no_competitor', label: 'No competitor price', tone: 'text-gray-400 border-gray-700' },
  { key: 'not_in_pos', label: 'Not in POS', tone: 'text-amber-400 border-amber-500/40' },
];

export default function PriceWatchPage() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const limit = 50;

  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [supplier, setSupplier] = useState('');
  const [category, setCategory] = useState('');
  const [competitor, setCompetitor] = useState('');
  const [verdict, setVerdict] = useState('');
  const [moversOnly, setMoversOnly] = useState(false);

  const filters: PriceWatchFilters = {
    search: search || undefined,
    supplier: supplier || undefined,
    category: category || undefined,
    competitor: competitor || undefined,
    verdict: verdict || undefined,
    moversOnly: moversOnly || undefined,
  };

  useEffect(() => {
    priceWatchApi
      .getSummary()
      .then((r) => setSummary(r.data?.data ?? null))
      .catch(() => setSummary(null));
  }, []);

  const loadRows = useCallback(() => {
    setLoading(true);
    priceWatchApi
      .getProducts({ ...filters, page, limit })
      .then((r) => {
        setRows(r.data?.data?.rows ?? []);
        setTotal(r.data?.data?.total ?? 0);
      })
      .catch(() => {
        setRows([]);
        setTotal(0);
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, supplier, category, competitor, verdict, moversOnly, page]);

  useEffect(loadRows, [loadRows]);

  // Debounced search
  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput);
      setPage(1);
    }, 350);
    return () => clearTimeout(t);
  }, [searchInput]);

  const handleExport = async () => {
    setExporting(true);
    try {
      const r = await priceWatchApi.exportCsv(filters);
      const url = URL.createObjectURL(new Blob([r.data], { type: 'text/csv' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `competitor-prices-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  };

  const lastRunDate = summary?.lastRun ? new Date(summary.lastRun.finishedAt) : null;
  const staleDays = lastRunDate
    ? Math.floor((Date.now() - lastRunDate.getTime()) / 86400000)
    : null;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const competitors = summary?.competitors ?? Object.keys(COMPETITOR_LABELS);

  const cardFilter = (key: string) => {
    setVerdict((v) => (v === key ? '' : key));
    setPage(1);
  };

  return (
    // MainLayout's <main> is overflow-hidden — each page scrolls itself.
    <div className="p-6 text-white h-full overflow-y-auto">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold">Competitor Prices</h1>
          <p className="text-sm text-gray-400">
            {lastRunDate
              ? `Last updated ${lastRunDate.toLocaleString('en-AU', {
                  weekday: 'short',
                  day: 'numeric',
                  month: 'short',
                  hour: 'numeric',
                  minute: '2-digit',
                })} — updates automatically every weekend`
              : 'No scrape data yet'}
            {summary?.scrapeRunning && (
              <span className="ml-2 text-amber-400 inline-flex items-center gap-1">
                <ArrowPathIcon className="h-4 w-4 animate-spin" /> update in progress…
              </span>
            )}
          </p>
        </div>
        <button
          onClick={handleExport}
          disabled={exporting}
          className="px-4 py-2 rounded-lg bg-pos-card border border-gray-700 text-sm font-semibold hover:border-gray-500 flex items-center gap-2"
        >
          <ArrowDownTrayIcon className="h-5 w-5" />
          {exporting ? 'Exporting…' : 'Export CSV'}
        </button>
      </div>

      {staleDays != null && staleDays > 8 && (
        <div className="mb-4 border border-amber-500/40 bg-amber-500/10 text-amber-300 rounded-md px-4 py-3 text-sm flex items-center gap-2">
          <ExclamationTriangleIcon className="h-5 w-5 shrink-0" />
          Prices are {staleDays} days old — last weekend's automatic update didn't complete.
          Let Avi know.
        </div>
      )}

      {/* Summary cards — click to filter */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-5">
        {CARD_DEFS.map((c) => (
          <button
            key={c.key}
            onClick={() => cardFilter(c.key)}
            className={`bg-pos-card rounded-xl border p-4 text-left transition-colors ${
              verdict === c.key ? 'ring-2 ring-amber-500 ' : ''
            }${c.tone}`}
          >
            <div className={`text-3xl font-extrabold ${c.tone.split(' ')[0]}`}>
              {summary ? (summary.cards[c.key] ?? 0).toLocaleString() : '…'}
            </div>
            <div className="text-xs text-gray-400 mt-1">{c.label}</div>
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="relative">
          <MagnifyingGlassIcon className="h-4 w-4 text-gray-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search SKU or product name"
            className="w-72 border border-gray-700 bg-pos-card rounded-md pl-9 pr-3 py-2 text-sm placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-amber-500"
          />
        </div>
        <select
          value={supplier}
          onChange={(e) => {
            setSupplier(e.target.value);
            setPage(1);
          }}
          className="border border-gray-700 bg-pos-card rounded-md px-3 py-2 text-sm"
        >
          <option value="">All suppliers</option>
          {(summary?.suppliers ?? []).map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select
          value={category}
          onChange={(e) => {
            setCategory(e.target.value);
            setPage(1);
          }}
          className="border border-gray-700 bg-pos-card rounded-md px-3 py-2 text-sm max-w-[220px]"
        >
          <option value="">All categories</option>
          {(summary?.categories ?? []).map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select
          value={competitor}
          onChange={(e) => {
            setCompetitor(e.target.value);
            setPage(1);
          }}
          className="border border-gray-700 bg-pos-card rounded-md px-3 py-2 text-sm"
        >
          <option value="">All competitors</option>
          {competitors.map((c) => (
            <option key={c} value={c}>
              {COMPETITOR_LABELS[c] ?? c}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-sm text-gray-300">
          <input
            type="checkbox"
            checked={moversOnly}
            onChange={(e) => {
              setMoversOnly(e.target.checked);
              setPage(1);
            }}
            className="rounded border-gray-600 bg-pos-card"
          />
          Only price changes this week
        </label>
        <div className="ml-auto text-sm text-gray-400">
          {total.toLocaleString()} rows
        </div>
      </div>

      {/* Table */}
      <div className="bg-pos-card rounded-xl border border-gray-700 overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-gray-400 border-b border-gray-700">
              <th className="px-3 py-3">SKU</th>
              <th className="px-3 py-3">Product</th>
              <th className="px-3 py-3">Supplier</th>
              <th className="px-3 py-3 text-right">Cost (inc)</th>
              <th className="px-3 py-3 text-right">POS price</th>
              {competitors.map((c) => (
                <th key={c} className="px-3 py-3 text-right">
                  {COMPETITOR_LABELS[c] ?? c}
                </th>
              ))}
              <th className="px-3 py-3">Verdict</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800">
            {loading ? (
              <tr>
                <td colSpan={7 + competitors.length} className="px-3 py-10 text-center text-gray-500">
                  Loading…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={7 + competitors.length} className="px-3 py-10 text-center text-gray-500">
                  Nothing matches these filters.
                </td>
              </tr>
            ) : (
              rows.map((r, i) => (
                <tr key={`${r.supplier}|${r.sku}|${i}`} className="hover:bg-pos-accent/20">
                  <td className="px-3 py-2 font-mono text-xs">{r.sku}</td>
                  <td className="px-3 py-2 max-w-[260px] truncate" title={r.name ?? ''}>
                    {r.name ?? <span className="text-gray-600">not in POS</span>}
                  </td>
                  <td className="px-3 py-2 text-gray-400">{r.supplier}</td>
                  <td className="px-3 py-2 text-right text-gray-400">{money(r.costIncGst)}</td>
                  <td className="px-3 py-2 text-right font-semibold">{money(r.posPrice)}</td>
                  {competitors.map((c) => {
                    const hit = r.competitors[c];
                    if (!hit) {
                      return (
                        <td key={c} className="px-3 py-2 text-right text-gray-700">
                          —
                        </td>
                      );
                    }
                    const delta =
                      hit.prevPrice != null
                        ? Math.round((hit.price - hit.prevPrice) * 100) / 100
                        : null;
                    const isMin = r.minCompetitor != null && hit.price === r.minCompetitor;
                    return (
                      <td key={c} className="px-3 py-2 text-right whitespace-nowrap">
                        {hit.url ? (
                          <a
                            href={hit.url}
                            target="_blank"
                            rel="noreferrer"
                            className={`hover:underline ${isMin ? 'text-amber-300 font-semibold' : ''}`}
                          >
                            {money(hit.price)}
                          </a>
                        ) : (
                          <span className={isMin ? 'text-amber-300 font-semibold' : ''}>
                            {money(hit.price)}
                          </span>
                        )}
                        {delta != null && delta !== 0 && (
                          <span
                            className={`block text-[11px] ${
                              delta > 0 ? 'text-red-400' : 'text-green-400'
                            }`}
                          >
                            {delta > 0 ? '▲' : '▼'} {money(Math.abs(delta))} vs last week
                          </span>
                        )}
                      </td>
                    );
                  })}
                  <td className="px-3 py-2">
                    {r.verdict === 'cheaper' && (
                      <span className="text-green-400 text-xs font-semibold">We're cheaper</span>
                    )}
                    {r.verdict === 'costlier' && (
                      <span className="text-red-400 text-xs font-semibold">We're costlier</span>
                    )}
                    {r.verdict === 'same' && <span className="text-gray-300 text-xs">Same</span>}
                    {r.verdict === 'no_competitor' && (
                      <span className="text-gray-500 text-xs">No competitor</span>
                    )}
                    {r.verdict === 'not_in_pos' && (
                      <span className="text-amber-400 text-xs">Not in POS</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between mt-4 text-sm">
        <button
          onClick={() => setPage((p) => Math.max(1, p - 1))}
          disabled={page <= 1}
          className="px-4 py-2 rounded-lg bg-pos-card border border-gray-700 disabled:opacity-40"
        >
          ← Previous
        </button>
        <span className="text-gray-400">
          Page {page} of {totalPages}
        </span>
        <button
          onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          disabled={page >= totalPages}
          className="px-4 py-2 rounded-lg bg-pos-card border border-gray-700 disabled:opacity-40"
        >
          Next →
        </button>
      </div>
    </div>
  );
}
