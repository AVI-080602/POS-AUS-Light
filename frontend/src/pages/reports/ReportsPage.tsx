import { ReactNode, useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { useLocation, useNavigate } from 'react-router-dom';
import { useSelector } from 'react-redux';
import type { RootState } from '../../store';
import { reportsApi, ReportRange } from '../../services/api';
import {
  money, int, pct, change, dateTime, dateOnly, periodLabel, presetRange, PRESETS, Preset,
  StatCard, Bars, DataTable, PrintSheet, downloadCsv, Col, CsvAllowedContext,
} from './reportKit';
import PurchaseOrderEditor from './PurchaseOrder';
import { formatPhone } from '../../utils/phone';

// Reports suite (Sally, Oct 2026). Every tab reads the same filter bar
// except End of Day (the till since its last close) and Backorders
// (everything still open).
type Tab =
  | 'eod' | 'summary' | 'pl' | 'clearance' | 'items' | 'belowcost' | 'trade' | 'staff' | 'customers' | 'backorders'
  | 'discounts' | 'quotes';

const TABS: Array<{ id: Tab; label: string; filters: boolean; groupBy?: boolean }> = [
  { id: 'eod', label: 'End of Day', filters: false },
  { id: 'summary', label: 'Sales Summary', filters: true, groupBy: true },
  { id: 'pl', label: 'Profit & Loss', filters: true, groupBy: true },
  { id: 'clearance', label: 'Clearance', filters: true, groupBy: true },
  { id: 'items', label: 'Sales by Item', filters: true },
  { id: 'belowcost', label: 'Below Cost', filters: false },
  { id: 'trade', label: 'Trade', filters: true, groupBy: true },
  { id: 'staff', label: 'Sales by Staff', filters: true },
  { id: 'customers', label: 'Customers', filters: true },
  { id: 'backorders', label: 'Backorders', filters: false },
  { id: 'discounts', label: 'Discounts', filters: true },
  { id: 'quotes', label: 'Quotes', filters: true },
];

// Website orders count in the reports by default (Sally, 16 Oct 2026:
// "all magento orders can feed into all the other reports").
const CHANNELS: Array<{ id: NonNullable<ReportRange['channel']>; label: string }> = [
  { id: 'all', label: 'Everything (in-store + website)' },
  { id: 'store', label: 'In-store (POS + old invoices)' },
  { id: 'pos', label: 'POS only' },
  { id: 'web', label: 'Website orders' },
];

const errMsg = (e: any) => e?.response?.data?.message || e?.message || 'Could not load the report';

// Sales staff: Sales Summary, Sales by Item, Sales by Staff and a read-only
// Backorders, with no CSV downloads (Sally, 15 + 16 Oct 2026).
const STAFF_TABS: Tab[] = ['summary', 'items', 'staff', 'backorders'];

export default function ReportsPage() {
  const me = useSelector((s: RootState) => s.auth.user);
  // Price Match: Backorders only, with no restrictions (Sally, 20 Oct 2026).
  const isPriceMatch = me?.role?.name === 'price_match';
  const isStaff = !isPriceMatch && me?.role?.name !== 'admin' && me?.role?.name !== 'manager';
  const visibleTabs = isPriceMatch
    ? TABS.filter((t) => t.id === 'backorders')
    : isStaff
      ? TABS.filter((t) => STAFF_TABS.includes(t.id))
      : TABS;
  // Coming back from an order opened on the Backorders tab lands on
  // Backorders again (Sally, 16 Oct 2026).
  const location = useLocation();
  const wantTab = (location.state as { tab?: Tab } | null)?.tab;
  const [tab, setTab] = useState<Tab>(
    wantTab && visibleTabs.some((t) => t.id === wantTab)
      ? wantTab
      : isPriceMatch
        ? 'backorders'
        : isStaff
          ? 'summary'
          : 'eod',
  );
  const [preset, setPreset] = useState<Preset>('this_month');
  const [range, setRange] = useState(() => presetRange('this_month'));
  const [channel, setChannel] = useState<NonNullable<ReportRange['channel']>>('all');
  const [groupBy, setGroupBy] = useState<'auto' | 'day' | 'week' | 'month' | 'year'>('auto');
  const [historyFor, setHistoryFor] = useState<number | null>(null);

  const meta = TABS.find((t) => t.id === tab)!;
  const params: ReportRange = {
    from: range.from,
    to: range.to,
    channel,
    ...(groupBy !== 'auto' ? { groupBy } : {}),
  };

  return (
    <CsvAllowedContext.Provider value={!isStaff}>
    <div className="h-full p-6 space-y-4 overflow-auto">
      <h1 className="text-2xl font-bold">Reports</h1>

      <div className="flex gap-1 overflow-x-auto pb-1">
        {visibleTabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-3 py-2 rounded-lg text-sm font-medium whitespace-nowrap ${
              tab === t.id ? 'bg-primary-600 text-white' : 'bg-pos-accent text-gray-300 hover:text-pos-text'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {meta.filters && (
        <div className="card p-4 flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs text-gray-400 mb-1">Period</label>
            <select
              className="input w-52"
              value={preset}
              onChange={(e) => {
                const p = e.target.value as Preset;
                setPreset(p);
                if (p !== 'custom') setRange(presetRange(p));
              }}
            >
              {PRESETS.map((p) => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">From</label>
            <input type="date" className="input w-40" value={range.from}
              onChange={(e) => { setPreset('custom'); setRange((r) => ({ ...r, from: e.target.value })); }} />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">To</label>
            <input type="date" className="input w-40" value={range.to}
              onChange={(e) => { setPreset('custom'); setRange((r) => ({ ...r, to: e.target.value })); }} />
          </div>
          {tab !== 'discounts' && tab !== 'quotes' && (
            <div>
              <label className="block text-xs text-gray-400 mb-1">Sales from</label>
              <select className="input w-60" value={channel} onChange={(e) => setChannel(e.target.value as any)}>
                {CHANNELS.map((c) => (
                  <option key={c.id} value={c.id}>{c.label}</option>
                ))}
              </select>
            </div>
          )}
          {meta.groupBy && (
            <div>
              <label className="block text-xs text-gray-400 mb-1">Group by</label>
              <select className="input w-32" value={groupBy} onChange={(e) => setGroupBy(e.target.value as any)}>
                <option value="auto">Auto</option>
                <option value="day">Day</option>
                <option value="week">Week</option>
                <option value="month">Month</option>
                <option value="year">Year</option>
              </select>
            </div>
          )}
        </div>
      )}

      {tab === 'eod' && <EndOfDay />}
      {tab === 'summary' && <SalesSummary params={params} />}
      {tab === 'pl' && <ProfitLoss params={params} />}
      {tab === 'clearance' && <Clearance params={params} />}
      {tab === 'items' && <SalesByItem params={params} showCost={!isStaff} />}
      {tab === 'belowcost' && <BelowCost />}
      {tab === 'trade' && <Trade params={params} onCustomer={setHistoryFor} />}
      {tab === 'staff' && <Staff params={params} />}
      {tab === 'customers' && <Customers params={params} onCustomer={setHistoryFor} />}
      {tab === 'backorders' && <Backorders readOnly={isStaff} />}
      {tab === 'discounts' && <Discounts params={params} />}
      {tab === 'quotes' && <Quotes params={params} />}

      {historyFor != null && <CustomerHistory id={historyFor} onClose={() => setHistoryFor(null)} />}
    </div>
    </CsvAllowedContext.Provider>
  );
}

// ------------------------------------------------------------ data hook
function useReport<T>(load: () => Promise<any>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    load()
      .then((r) => { if (!cancelled) setData(r.data?.data ?? null); })
      .catch((e) => { if (!cancelled) setError(errMsg(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => reload(), [reload]);
  return { data, loading, error, reload };
}

function State({ loading, error, children }: { loading: boolean; error: string | null; children: ReactNode }) {
  if (error) return <div className="card p-6 text-red-400">{error}</div>;
  if (loading) return <div className="card p-6 text-gray-400">Loading…</div>;
  return <>{children}</>;
}

const Note = ({ children }: { children: ReactNode }) => <p className="text-xs text-gray-400">{children}</p>;

// ============================================================ END OF DAY
type EodTotals = {
  transactions: number; gross: number; discounts: number; tax: number; delivery: number;
  byCustomerType: Array<{ type: string; transactions: number; total: number }>;
  bySaleType: Array<{ type: string; transactions: number; total: number }>;
  payments: Array<{ method: string; count: number; amount: number }>;
  paymentsTotal: number;
  refunds: { count: number; amount: number; cash: number; storeCredit: number };
  netTakings: number; cashExpected: number;
};
type DayCloseRow = {
  id: number; openedAt: string; closedAt: string; closedByName: string | null;
  cashCounted: number | null; cashDifference: number | null; notes: string | null; totals: EodTotals;
};
const METHOD: Record<string, string> = {
  cash: 'Cash', eftpos: 'EFTPOS', credit_card: 'Credit card', bank_transfer: 'Bank transfer',
  store_credit: 'Store credit', other: 'Other',
};

function EodBreakdown({ t }: { t: EodTotals }) {
  const row = (label: string, value: ReactNode, strong = false) => (
    <div className={`flex justify-between py-1 ${strong ? 'font-bold border-t border-gray-300 mt-1 pt-2' : ''}`}>
      <span>{label}</span><span className="tabular-nums">{value}</span>
    </div>
  );
  return (
    <div className="grid md:grid-cols-2 gap-6">
      <div>
        <h4 className="font-semibold mb-1">Sales</h4>
        {row('Transactions', int(t.transactions))}
        {row('Gross sales (inc GST)', money(t.gross))}
        {row('Discounts given', money(t.discounts))}
        {row('GST collected', money(t.tax))}
        {row('Delivery fees', money(t.delivery))}
        <h4 className="font-semibold mt-4 mb-1">Customer type</h4>
        {t.byCustomerType.length === 0 && <p className="text-gray-500">No sales.</p>}
        {t.byCustomerType.map((x) => row(`${x.type} (${x.transactions})`, money(x.total)))}
        <h4 className="font-semibold mt-4 mb-1">Sale type</h4>
        {t.bySaleType.length === 0 && <p className="text-gray-500">No sales.</p>}
        {t.bySaleType.map((x) => row(`${x.type} (${x.transactions})`, money(x.total)))}
      </div>
      <div>
        <h4 className="font-semibold mb-1">Payments taken</h4>
        {t.payments.length === 0 && <p className="text-gray-500">No payments.</p>}
        {t.payments.map((p) => row(`${METHOD[p.method] || p.method} (${p.count})`, money(p.amount)))}
        {row('Total payments', money(t.paymentsTotal), true)}
        <h4 className="font-semibold mt-4 mb-1">Refunds</h4>
        {row(`Refunds given (${t.refunds.count})`, money(t.refunds.amount))}
        {row('— paid in cash', money(t.refunds.cash))}
        {row('— as store credit', money(t.refunds.storeCredit))}
        {row('Net takings (payments less cash refunds)', money(t.netTakings), true)}
        {row('Cash expected in drawer', money(t.cashExpected), true)}
      </div>
    </div>
  );
}

function EndOfDay() {
  const { data, loading, error, reload } = useReport<{ window: { start: string; end: string }; lastClose: any; totals: EodTotals }>(
    () => reportsApi.eod(), [],
  );
  const hist = useReport<DayCloseRow[]>(() => reportsApi.eodHistory(60), []);
  const [cash, setCash] = useState('');
  const [notes, setNotes] = useState('');
  const [closing, setClosing] = useState(false);
  const [printing, setPrinting] = useState<DayCloseRow | null>(null);

  const close = async () => {
    if (!data) return;
    const t = data.totals;
    if (!window.confirm(
      `Close the day?\n\n${int(t.transactions)} transactions, ${money(t.gross)} sales, ${money(t.paymentsTotal)} taken.\n\n` +
      'The totals are saved and the End of Day starts again from zero.',
    )) return;
    const c = cash.trim() === '' ? null : Number(cash);
    if (c != null && (!Number.isFinite(c) || c < 0)) { toast.error('Cash counted must be a number'); return; }
    setClosing(true);
    try {
      const r = await reportsApi.closeDay({ cashCounted: c, notes: notes.trim() || undefined });
      toast.success('Day closed');
      setCash(''); setNotes('');
      setPrinting(r.data.data);
      reload(); hist.reload();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setClosing(false);
    }
  };

  return (
    <State loading={loading && !data} error={error}>
      {data && (
        <div className="space-y-4">
          <div className="card p-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-semibold">POS till since {dateTime(data.window.start)}</p>
              <Note>
                {data.lastClose
                  ? `Last closed ${dateTime(data.lastClose.closedAt)}${data.lastClose.closedByName ? ` by ${data.lastClose.closedByName}` : ''}.`
                  : 'Not closed before — counting from the start of today.'}{' '}
                Sales are counted when placed; payments and refunds when taken.
              </Note>
            </div>
            <button className="btn-secondary text-sm" onClick={() => { reload(); hist.reload(); }}>Refresh</button>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
            <StatCard label="Transactions" value={int(data.totals.transactions)} />
            <StatCard label="Gross sales" value={money(data.totals.gross)} />
            <StatCard label="Payments taken" value={money(data.totals.paymentsTotal)} />
            <StatCard label="Refunds" value={money(data.totals.refunds.amount)} sub={`${data.totals.refunds.count} refunds`} />
            <StatCard label="Net takings" value={money(data.totals.netTakings)} />
            <StatCard label="Cash in drawer" value={money(data.totals.cashExpected)} sub="expected" />
          </div>

          <div className="card p-5"><EodBreakdown t={data.totals} /></div>

          <div className="card p-5">
            <h3 className="font-semibold mb-3">Close the day</h3>
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="block text-xs text-gray-400 mb-1">Cash counted (optional)</label>
                <input type="number" step="0.05" min={0} className="input w-40" value={cash}
                  onChange={(e) => setCash(e.target.value)} placeholder={data.totals.cashExpected.toFixed(2)} />
              </div>
              <div className="flex-1 min-w-[220px]">
                <label className="block text-xs text-gray-400 mb-1">Notes (optional)</label>
                <input type="text" className="input w-full" value={notes} maxLength={500}
                  onChange={(e) => setNotes(e.target.value)} placeholder="e.g. $20 float left in drawer" />
              </div>
              <button className="btn-primary" disabled={closing} onClick={close}>
                {closing ? 'Closing…' : 'Close Day'}
              </button>
            </div>
            {cash.trim() !== '' && Number.isFinite(Number(cash)) && (
              <p className={`text-sm mt-2 ${Math.abs(Number(cash) - data.totals.cashExpected) < 0.005 ? 'text-green-500' : 'text-amber-500'}`}>
                Difference: {money(Number(cash) - data.totals.cashExpected)}
              </p>
            )}
          </div>

          <DataTable<DayCloseRow>
            title="Previous day closes"
            csvName="day-closes.csv"
            rows={hist.data || []}
            empty="No days closed yet."
            onRowClick={(r) => setPrinting(r)}
            columns={[
              { key: 'closed', label: 'Closed', render: (r) => dateTime(r.closedAt), value: (r) => r.closedAt },
              { key: 'by', label: 'By', value: (r) => r.closedByName || '' },
              { key: 'tx', label: 'Transactions', align: 'right', value: (r) => r.totals.transactions, render: (r) => int(r.totals.transactions) },
              { key: 'gross', label: 'Sales', align: 'right', value: (r) => r.totals.gross, render: (r) => money(r.totals.gross) },
              { key: 'taken', label: 'Payments', align: 'right', value: (r) => r.totals.paymentsTotal, render: (r) => money(r.totals.paymentsTotal) },
              { key: 'exp', label: 'Cash expected', align: 'right', value: (r) => r.totals.cashExpected, render: (r) => money(r.totals.cashExpected) },
              { key: 'cnt', label: 'Cash counted', align: 'right', value: (r) => r.cashCounted ?? '', render: (r) => money(r.cashCounted) },
              {
                key: 'diff', label: 'Difference', align: 'right', value: (r) => r.cashDifference ?? '',
                render: (r) => r.cashDifference == null ? '—' : (
                  <span className={Math.abs(r.cashDifference) < 0.005 ? 'text-green-500' : 'text-amber-500'}>{money(r.cashDifference)}</span>
                ),
              },
            ]}
          />
          <Note>Click a past close to view or reprint it.</Note>

          {printing && (
            <PrintSheet title="End of Day — Z Report" onClose={() => setPrinting(null)}>
              <p className="mb-4 text-gray-600">
                Australian Lighting & Fans · {dateTime(printing.openedAt)} to {dateTime(printing.closedAt)}
                {printing.closedByName ? ` · closed by ${printing.closedByName}` : ''}
              </p>
              <EodBreakdown t={printing.totals} />
              <div className="mt-4 border-t border-gray-300 pt-2">
                <div className="flex justify-between"><span>Cash counted</span><span>{money(printing.cashCounted)}</span></div>
                <div className="flex justify-between font-bold"><span>Difference</span><span>{money(printing.cashDifference)}</span></div>
                {printing.notes && <p className="mt-2">Notes: {printing.notes}</p>}
              </div>
            </PrintSheet>
          )}
        </div>
      )}
    </State>
  );
}

// ============================================================ SALES SUMMARY
type Totals = {
  transactions: number; gross: number; discounts: number; tax: number; delivery: number; refunds: number;
  refundTotal: number; net: number; netExGst: number; averageSale: number; tradeTransactions: number; tradeSales: number;
};
type Summary = {
  range: { from: string; to: string; groupBy: string };
  previousRange: { from: string; to: string };
  current: Totals; previous: Totals;
  series: Array<{ period: string; transactions: number; gross: number; refunds: number; net: number }>;
};

function SummaryCards({ s }: { s: Summary }) {
  const c = s.current, p = s.previous;
  const vs = `vs ${dateOnly(s.previousRange.from)} – ${dateOnly(s.previousRange.to)}`;
  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Net sales" value={money(c.net)} delta={change(c.net, p.net)} sub={`${money(p.net)} before`} />
        <StatCard label="Transactions" value={int(c.transactions)} delta={change(c.transactions, p.transactions)} sub={`${int(p.transactions)} before`} />
        <StatCard label="Average sale" value={money(c.averageSale)} delta={change(c.averageSale, p.averageSale)} sub={`${money(p.averageSale)} before`} />
        <StatCard label="Refunds" value={money(c.refundTotal)} sub={`${c.refunds} refunds · ${money(p.refundTotal)} before`} />
        <StatCard label="Gross sales" value={money(c.gross)} delta={change(c.gross, p.gross)} />
        <StatCard label="Net sales ex GST" value={money(c.netExGst)} delta={change(c.netExGst, p.netExGst)} />
        <StatCard label="GST collected" value={money(c.tax)} />
        <StatCard label="Discounts given" value={money(c.discounts)} />
      </div>
      <Note>Compared with the previous period of the same length ({vs}).</Note>
    </>
  );
}

function SalesSummary({ params }: { params: ReportRange }) {
  const key = JSON.stringify(params);
  const { data, loading, error } = useReport<Summary>(() => reportsApi.summary(params), [key]);
  return (
    <State loading={loading} error={error}>
      {data && (
        <div className="space-y-4">
          <SummaryCards s={data} />
          <div className="card p-4">
            <p className="font-semibold mb-3">Net sales by {data.range.groupBy}</p>
            <Bars rows={data.series} value={(r) => r.net} label={(r) => periodLabel(r.period, data.range.groupBy)} fmt={(v) => money(v)} />
          </div>
          <DataTable
            title="By period"
            csvName={`sales-summary-${data.range.from}-to-${data.range.to}.csv`}
            rows={data.series}
            columns={[
              { key: 'p', label: 'Period', value: (r) => r.period, render: (r) => periodLabel(r.period, data.range.groupBy) },
              { key: 't', label: 'Transactions', align: 'right', value: (r) => r.transactions, render: (r) => int(r.transactions) },
              { key: 'g', label: 'Gross sales', align: 'right', value: (r) => r.gross, render: (r) => money(r.gross) },
              { key: 'r', label: 'Refunds', align: 'right', value: (r) => r.refunds, render: (r) => money(r.refunds) },
              { key: 'n', label: 'Net sales', align: 'right', value: (r) => r.net, render: (r) => money(r.net) },
            ]}
          />
        </div>
      )}
    </State>
  );
}

// ============================================================ P&L
function ProfitLoss({ params }: { params: ReportRange }) {
  const key = JSON.stringify(params);
  const { data, loading, error } = useReport<any>(() => reportsApi.profitLoss(params), [key]);
  return (
    <State loading={loading} error={error}>
      {data && (() => {
        const t = data.totals;
        const line = (label: string, value: ReactNode, opts: { strong?: boolean; indent?: boolean } = {}) => (
          <div className={`flex justify-between py-1.5 ${opts.strong ? 'font-bold border-t border-gray-700 mt-1 pt-2' : ''} ${opts.indent ? 'pl-4 text-gray-400' : ''}`}>
            <span>{label}</span><span className="tabular-nums">{value}</span>
          </div>
        );
        return (
          <div className="space-y-4">
            <div className="grid lg:grid-cols-3 gap-4">
              <div className="card p-5 lg:col-span-2">
                <p className="font-semibold mb-2">Profit & loss, {dateOnly(data.range.from)} – {dateOnly(data.range.to)} (ex GST)</p>
                {line('Sales', money(t.salesExGst))}
                {line('includes delivery fees', money(t.deliveryExGst), { indent: true })}
                {line('Less refunds', money(-t.refundsExGst))}
                {line('Net sales', money(t.netSalesExGst), { strong: true })}
                {line('Sales of items with a cost on file', money(t.costedSalesExGst))}
                {line('Less cost of goods sold', money(-t.cogsExGst))}
                {line('Gross profit (on items with a cost)', money(t.grossProfit), { strong: true })}
                {line('Gross margin', pct(t.marginPct))}
                {line('Sales with no cost on file (not in gross profit)', money(t.uncostedSalesExGst), { indent: true })}
              </div>
              <div className="space-y-3">
                <StatCard label="Gross profit" value={money(t.grossProfit)} tone={t.grossProfit < 0 ? 'bad' : undefined} />
                <StatCard label="Gross margin" value={pct(t.marginPct)} />
                <StatCard label="Cost coverage" value={pct(t.costCoveragePct)} sub="of sales have a cost price" />
              </div>
            </div>
            <Note>
              Gross profit only — rent, wages and other expenses aren't in the POS. Cost is the product's cost price at the time of sale;
              refunded items put back on the shelf return their cost. Old imported invoices have no cost, so they show in sales but not in gross profit.
            </Note>
            <DataTable
              title={`By ${data.range.groupBy}`}
              csvName={`profit-loss-${data.range.from}-to-${data.range.to}.csv`}
              rows={data.rows}
              columns={[
                { key: 'p', label: 'Period', value: (r: any) => r.period, render: (r: any) => periodLabel(r.period, data.range.groupBy) },
                { key: 'tx', label: 'Transactions', align: 'right', value: (r: any) => r.transactions, render: (r: any) => int(r.transactions) },
                { key: 's', label: 'Sales ex GST', align: 'right', value: (r: any) => r.salesExGst, render: (r: any) => money(r.salesExGst) },
                { key: 'r', label: 'Refunds', align: 'right', value: (r: any) => r.refundsExGst, render: (r: any) => money(r.refundsExGst) },
                { key: 'n', label: 'Net sales', align: 'right', value: (r: any) => r.netSalesExGst, render: (r: any) => money(r.netSalesExGst) },
                { key: 'c', label: 'COGS', align: 'right', value: (r: any) => r.cogsExGst, render: (r: any) => money(r.cogsExGst) },
                { key: 'gp', label: 'Gross profit', align: 'right', value: (r: any) => r.grossProfit, render: (r: any) => money(r.grossProfit) },
                { key: 'm', label: 'Margin', align: 'right', value: (r: any) => r.marginPct ?? '', render: (r: any) => pct(r.marginPct) },
                { key: 'cov', label: 'Cost coverage', align: 'right', value: (r: any) => r.costCoveragePct ?? '', render: (r: any) => pct(r.costCoveragePct) },
              ]}
            />
          </div>
        );
      })()}
    </State>
  );
}

// ============================================================ CLEARANCE
function Clearance({ params }: { params: ReportRange }) {
  const key = JSON.stringify(params);
  const { data, loading, error } = useReport<any>(() => reportsApi.clearance(params), [key]);
  return (
    <State loading={loading} error={error}>
      {data && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatCard label="Clearance units sold" value={int(data.totals.units)} />
            <StatCard label="Clearance revenue" value={money(data.totals.revenue)} />
            <StatCard label="Orders with clearance" value={int(data.totals.orders)} />
            <StatCard label="Different products" value={int(data.totals.products)} />
          </div>
          <div className="card p-4">
            <p className="font-semibold mb-3">Units sold by {data.range.groupBy}</p>
            <Bars rows={data.series} value={(r: any) => r.units} label={(r: any) => periodLabel(r.period, data.range.groupBy)} />
          </div>
          <DataTable
            title="Top 10 clearance products"
            csvName={`clearance-top10-${data.range.from}-to-${data.range.to}.csv`}
            rows={data.top}
            columns={[
              { key: 'sku', label: 'SKU', value: (r: any) => r.sku },
              { key: 'n', label: 'Product', value: (r: any) => r.name },
              { key: 'u', label: 'Units sold', align: 'right', value: (r: any) => r.units, render: (r: any) => int(r.units) },
              { key: 'rev', label: 'Revenue', align: 'right', value: (r: any) => r.revenue, render: (r: any) => money(r.revenue) },
              { key: 'st', label: 'Still in stock', align: 'right', value: (r: any) => r.stock, render: (r: any) => int(r.stock) },
            ]}
          />
          <Note>Counts products that sit in a Clearance category on the website. Old imported invoices aren't linked to products, so they aren't included.</Note>
        </div>
      )}
    </State>
  );
}

// ============================================================ BY ITEM
type ItemRow = {
  productId: number | null; sku: string; name: string; units: number; orders: number; revenue: number;
  revenueExGst: number; costIncGst: number | null; marginExGst: number | null; marginPct: number | null;
};
const itemColumns: Col<ItemRow>[] = [
  { key: 'sku', label: 'SKU', value: (r) => r.sku },
  { key: 'name', label: 'Product', value: (r) => r.name },
  { key: 'units', label: 'Units', align: 'right', value: (r) => r.units, render: (r) => int(r.units) },
  { key: 'orders', label: 'Orders', align: 'right', value: (r) => r.orders, render: (r) => int(r.orders) },
  { key: 'rev', label: 'Revenue (inc GST)', align: 'right', value: (r) => r.revenue, render: (r) => money(r.revenue) },
  { key: 'cost', label: 'Cost (inc GST)', align: 'right', value: (r) => r.costIncGst ?? '', render: (r) => money(r.costIncGst) },
  { key: 'm', label: 'Margin ex GST', align: 'right', value: (r) => r.marginExGst ?? '', render: (r) => money(r.marginExGst) },
  {
    key: 'mp', label: 'Margin %', align: 'right', value: (r) => r.marginPct ?? '',
    render: (r) => <span className={r.marginPct != null && r.marginPct < 16.7 ? 'text-amber-500' : ''}>{pct(r.marginPct)}</span>,
  },
];

// Cost and margin are for managers and admins; the API blanks them for
// sales staff and the columns are hidden.
const COST_KEYS = ['cost', 'm', 'mp'];

function SalesByItem({ params, showCost = true }: { params: ReportRange; showCost?: boolean }) {
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => { const t = setTimeout(() => setQ(search.trim()), 400); return () => clearTimeout(t); }, [search]);
  const key = JSON.stringify(params) + q;
  const { data, loading, error } = useReport<{ items: ItemRow[]; unitemised: { lines: number; revenue: number } }>(
    () => reportsApi.items({ ...params, search: q || undefined, limit: 2000 }), [key],
  );
  return (
    <div className="space-y-3">
      <input className="input w-full md:w-96" placeholder="Filter by SKU or product name…" value={search} onChange={(e) => setSearch(e.target.value)} />
      <State loading={loading} error={error}>
        {data && (
          <>
            <DataTable
              title={`${int(data.items.length)} products`}
              csvName={`sales-by-item-${params.from}-to-${params.to}.csv`}
              rows={data.items}
              columns={showCost ? itemColumns : itemColumns.filter((c) => !COST_KEYS.includes(c.key))}
              maxHeight={620}
            />
            <Note>
              {showCost &&
                'Cost is what the product cost when it sold, inc GST like the cost on the product. Margin is ex GST (revenue less cost, ÷ 1.1). A dash means no cost was on file; once one is added, this financial year\'s sales take it. A cost changed in Magento comes across at the next product sync.'}
              {data.unitemised.lines > 0 &&
                ` ${int(data.unitemised.lines)} lines from old imported invoices (${money(data.unitemised.revenue)}) have no product code and aren't itemised.`}
              {' '}Showing up to 2,000 products, highest revenue first. Click a column to sort.
            </Note>
          </>
        )}
      </State>
    </div>
  );
}

// ============================================================ BELOW COST
// Today's prices, not sales, so no date filters. Managers and admins only:
// it shows cost (Sally, 5 Nov 2026).
type BelowCostRow = {
  id: number; sku: string; name: string; supplier: string | null; rrp: number; price: number; onSale: boolean;
  cost: number; minPrice: number; overCost: number; overCostPct: number; stock: number; belowCost: boolean;
};
const belowCostColumns = (marginPct: number): Col<BelowCostRow>[] => [
  { key: 'sku', label: 'SKU', value: (r) => r.sku },
  { key: 'name', label: 'Product', value: (r) => r.name },
  { key: 'sup', label: 'Supplier', value: (r) => r.supplier ?? '' },
  { key: 'rrp', label: 'RRP', align: 'right', value: (r) => r.rrp, render: (r) => money(r.rrp) },
  { key: 'price', label: 'Selling at', align: 'right', value: (r) => r.price, render: (r) => money(r.price) },
  { key: 'sale', label: 'On sale', align: 'center', value: (r) => (r.onSale ? 'Yes' : 'No') },
  { key: 'cost', label: 'Cost', align: 'right', value: (r) => r.cost, render: (r) => money(r.cost) },
  { key: 'min', label: `Cost + ${marginPct}%`, align: 'right', value: (r) => r.minPrice, render: (r) => money(r.minPrice) },
  {
    key: 'over', label: 'Above / below cost', align: 'right', value: (r) => r.overCost,
    render: (r) => <span className={r.belowCost ? 'text-red-500 font-semibold' : ''}>{money(r.overCost)}</span>,
  },
  {
    key: 'pct', label: '% of cost', align: 'right', value: (r) => r.overCostPct,
    render: (r) => <span className={r.belowCost ? 'text-red-500 font-semibold' : ''}>{pct(r.overCostPct)}</span>,
  },
  { key: 'stock', label: 'Stock', align: 'right', value: (r) => r.stock, render: (r) => int(r.stock) },
];

function BelowCost() {
  const [show, setShow] = useState<'cost' | 'margin'>('cost');
  const [search, setSearch] = useState('');
  const { data, loading, error } = useReport<{
    minMarginPercent: number; checked: number; belowCost: number; belowMargin: number; items: BelowCostRow[];
  }>(() => reportsApi.belowCost(), []);
  const q = search.trim().toLowerCase();
  const rows = (data?.items || []).filter(
    (r) =>
      (show === 'margin' || r.belowCost) &&
      (!q || [r.sku, r.name, r.supplier || ''].some((v) => v.toLowerCase().includes(q))),
  );
  return (
    <State loading={loading} error={error}>
      {data && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            {(
              [
                ['cost', `Below cost (${int(data.belowCost)})`],
                ['margin', `Below cost + ${data.minMarginPercent}% (${int(data.belowMargin)})`],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                onClick={() => setShow(id)}
                className={`px-3 py-2 rounded-lg text-sm font-medium ${
                  show === id ? 'bg-primary-600 text-white' : 'bg-pos-accent text-gray-300 hover:text-pos-text'
                }`}
              >
                {label}
              </button>
            ))}
            <input
              className="input w-full md:w-96"
              placeholder="Filter by SKU, product or supplier…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <DataTable
            title={`${int(rows.length)} products`}
            csvName={show === 'cost' ? 'below-cost.csv' : 'below-minimum-margin.csv'}
            rows={rows}
            columns={belowCostColumns(data.minMarginPercent)}
            maxHeight={620}
            initialSort={{ key: 'pct', dir: 'asc' }}
            empty="Nothing below cost."
          />
          <Note>
            Today's prices against the cost on the product, both inc GST. Selling at is what a customer pays
            today, so the sale price while one is running. Below cost + {data.minMarginPercent}% is the same
            check as the Below minimum margin warning at the till. Checked {int(data.checked)} active products
            with a cost on file; products with no cost can't be checked. Click a column to sort.
          </Note>
        </div>
      )}
    </State>
  );
}

// ============================================================ TRADE
type CustomerRow = {
  id: number; name: string; company: string | null; phone: string | null; isTrade: boolean;
  orders: number; revenue: number; averageOrder: number; lastPurchase: string | null;
};
const customerColumns = (showTrade: boolean): Col<CustomerRow>[] => [
  {
    key: 'name', label: 'Customer', value: (r) => r.name,
    render: (r) => (
      <span className="flex items-center gap-2">
        {r.name || '—'}
        {showTrade && r.isTrade && <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase bg-orange-600/30 text-orange-300">Trade</span>}
      </span>
    ),
  },
  { key: 'company', label: 'Company', value: (r) => r.company || '' },
  { key: 'phone', label: 'Phone', value: (r) => formatPhone(r.phone) },
  { key: 'orders', label: 'Orders', align: 'right', value: (r) => r.orders, render: (r) => int(r.orders) },
  { key: 'rev', label: 'Spend', align: 'right', value: (r) => r.revenue, render: (r) => money(r.revenue) },
  { key: 'avg', label: 'Average order', align: 'right', value: (r) => r.averageOrder, render: (r) => money(r.averageOrder) },
  { key: 'last', label: 'Last purchase', value: (r) => r.lastPurchase || '', render: (r) => dateOnly(r.lastPurchase) },
];

function Trade({ params, onCustomer }: { params: ReportRange; onCustomer: (id: number) => void }) {
  const key = JSON.stringify(params);
  const { data, loading, error } = useReport<{ summary: Summary; customers: CustomerRow[]; products: ItemRow[] }>(
    () => reportsApi.trade(params), [key],
  );
  return (
    <State loading={loading} error={error}>
      {data && (
        <div className="space-y-4">
          <SummaryCards s={data.summary} />
          <div className="card p-4">
            <p className="font-semibold mb-3">Trade sales by {data.summary.range.groupBy}</p>
            <Bars rows={data.summary.series} value={(r) => r.net} label={(r) => periodLabel(r.period, data.summary.range.groupBy)} fmt={(v) => money(v)} />
          </div>
          <DataTable
            title="Best trade customers"
            csvName={`trade-customers-${params.from}-to-${params.to}.csv`}
            rows={data.customers}
            columns={customerColumns(false)}
            onRowClick={(r) => onCustomer(r.id)}
          />
          <DataTable
            title="Top products sold to trade"
            csvName={`trade-products-${params.from}-to-${params.to}.csv`}
            rows={data.products}
            columns={itemColumns}
          />
          <Note>
            Trade is recorded on every sale from 7 Oct 2026. Earlier sales count as trade only if the customer is marked trade,
            so older periods will undercount. Click a customer to see their purchase history.
          </Note>
        </div>
      )}
    </State>
  );
}

// ============================================================ STAFF
function Staff({ params }: { params: ReportRange }) {
  const key = JSON.stringify(params);
  const { data, loading, error } = useReport<any[]>(() => reportsApi.staff(params), [key]);
  return (
    <State loading={loading} error={error}>
      {data && (
        <div className="space-y-2">
          <DataTable
            title="Sales by staff member"
            csvName={`sales-by-staff-${params.from}-to-${params.to}.csv`}
            rows={data}
            columns={[
              { key: 'n', label: 'Staff member', value: (r: any) => r.name },
              { key: 't', label: 'Transactions', align: 'right', value: (r: any) => r.transactions, render: (r: any) => int(r.transactions) },
              { key: 'rev', label: 'Revenue', align: 'right', value: (r: any) => r.revenue, render: (r: any) => money(r.revenue) },
              { key: 'avg', label: 'Average sale', align: 'right', value: (r: any) => r.averageSale, render: (r: any) => money(r.averageSale) },
              { key: 'd', label: 'Discounts given', align: 'right', value: (r: any) => r.discounts, render: (r: any) => money(r.discounts) },
              { key: 'tt', label: 'Trade sales', align: 'right', value: (r: any) => r.tradeTransactions, render: (r: any) => int(r.tradeTransactions) },
              { key: 'rf', label: 'Refunds given', align: 'right', value: (r: any) => r.refundAmount, render: (r: any) => `${money(r.refundAmount)} (${r.refunds})` },
            ]}
          />
          <Note>Sales are credited to whoever was logged in when the sale was put through. Old imported invoices are shown as one line.</Note>
        </div>
      )}
    </State>
  );
}

// ============================================================ CUSTOMERS
function Customers({ params, onCustomer }: { params: ReportRange; onCustomer: (id: number) => void }) {
  const key = JSON.stringify(params);
  const { data, loading, error } = useReport<CustomerRow[]>(() => reportsApi.customers({ ...params, limit: 200 }), [key]);
  return (
    <State loading={loading} error={error}>
      {data && (
        <div className="space-y-2">
          <DataTable
            title="Top customers by spend"
            csvName={`top-customers-${params.from}-to-${params.to}.csv`}
            rows={data}
            columns={customerColumns(true)}
            onRowClick={(r) => onCustomer(r.id)}
            maxHeight={620}
          />
          <Note>Top 200 named customers in the period. Walk-in sales with no customer aren't included. Click a customer for their full purchase history.</Note>
        </div>
      )}
    </State>
  );
}

const SOURCE: Record<string, string> = { pos: 'POS', magento: 'Website', legacy: 'Old invoice' };

function CustomerHistory({ id, onClose }: { id: number; onClose: () => void }) {
  const { data, loading, error } = useReport<any>(() => reportsApi.customerHistory(id), [id]);
  return (
    <div className="modal-backdrop-top" onClick={onClose}>
      <div className="m-auto w-full max-w-4xl max-h-[90vh] overflow-auto card p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-start mb-4 gap-3">
          <div>
            <h2 className="text-xl font-bold">{data?.customer?.name || 'Customer'}</h2>
            <p className="text-sm text-gray-400">
              {[data?.customer?.company, data?.customer?.phone, data?.customer?.email].filter(Boolean).join(' · ')}
              {data?.customer?.isTrade ? ' · Trade' : ''}
            </p>
          </div>
          <button className="btn-secondary" onClick={onClose}>Close</button>
        </div>
        <State loading={loading} error={error}>
          {data && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <StatCard label="Lifetime spend" value={money(data.summary.lifetimeSpend)} sub="after refunds" />
                <StatCard label="Orders" value={int(data.summary.orders)} />
                <StatCard label="First purchase" value={<span className="text-base">{dateOnly(data.summary.firstPurchase)}</span>} />
                <StatCard label="Last purchase" value={<span className="text-base">{dateOnly(data.summary.lastPurchase)}</span>} />
              </div>
              <DataTable
                title="Purchase history"
                csvName={`customer-${id}-history.csv`}
                rows={data.orders}
                maxHeight={420}
                columns={[
                  { key: 'd', label: 'Date', value: (r: any) => r.createdAt, render: (r: any) => dateOnly(r.createdAt) },
                  { key: 'n', label: 'Order', value: (r: any) => r.orderNumber },
                  { key: 's', label: 'From', value: (r: any) => SOURCE[r.source] || r.source },
                  { key: 'st', label: 'Status', value: (r: any) => r.status.replace(/_/g, ' ') },
                  { key: 'i', label: 'Items', align: 'right', value: (r: any) => r.items },
                  { key: 't', label: 'Total', align: 'right', value: (r: any) => r.total, render: (r: any) => money(r.total) },
                  { key: 'r', label: 'Refunded', align: 'right', value: (r: any) => r.refunded, render: (r: any) => (r.refunded ? money(r.refunded) : '') },
                ]}
              />
            </div>
          )}
        </State>
      </div>
    </div>
  );
}

// ============================================================ BACKORDERS
type BoLine = {
  lineId: number; orderId: number; orderNumber: string; orderedAt: string; daysWaiting: number; status: string;
  customer: string; company: string | null; phone: string | null; sku: string; name: string; qty: number; value: number;
  // Ex GST (Sally, 8 Oct 2026: wholesalers' minimum orders). Null = no cost known.
  unitCostEx: number | null; costEx: number | null;
  // Ordered from the supplier on this PO (Sally, 15 Oct 2026). Null = not yet.
  poNumber: string | null; poSentAt: string | null;
  source?: 'pos' | 'magento' | 'legacy';
  // Supplier quantity-break cost (EGLO, 22 Oct 2026).
  standardCostEx?: number | null; bulkCostEx?: number | null; bulkMinQty?: number | null; bulkApplied?: boolean;
  // Latest comment on the website order in Magento (Sally, 26 Oct 2026).
  webComment?: string | null; webCommentAt?: string | null;
};
type BoGroup = { supplier: string; lines: BoLine[]; units: number; value: number; costEx: number; linesWithoutCost: number };

// A picked day + optional time as a local timestamp. With no time the
// range covers the whole day; an end time includes its whole minute.
const boundary = (day: string, time: string, end: boolean): number =>
  new Date(`${day}T${time || (end ? '23:59' : '00:00')}`).getTime() + (end ? 59999 : 0);
const fmtTime = (t: string): string => {
  const [h, m] = t.split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
};

// The Backorders filters survive opening an order and pressing Back
// (Sally, 16 Oct 2026) — kept for this browser tab only.
const BO_FILTERS_KEY = 'pos_backorders_filters';
type BoFilters = {
  supplier?: string; from?: string; to?: string; fromTime?: string; toTime?: string;
  query?: string; poState?: 'all' | 'open' | 'ordered';
};
function loadBoFilters(): BoFilters {
  try {
    const v = JSON.parse(sessionStorage.getItem(BO_FILTERS_KEY) || '{}');
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

// readOnly: sales staff can see backorders but not raise / mark purchase
// orders or export them (Sally, 15 + 16 Oct 2026).
function Backorders({ readOnly = false }: { readOnly?: boolean }) {
  const { data, loading, error, reload } = useReport<{ suppliers: BoGroup[]; totals: any }>(() => reportsApi.backorders(), []);
  const navigate = useNavigate();
  const [saved] = useState(loadBoFilters);
  const [supplier, setSupplier] = useState(saved.supplier || 'all');
  // Ordered date + time filter (Sally, 8 Oct 2026: "Can we filter by
  // Date"; 12 Oct: "also have a filter of 'time' like we have with
  // 'date'"). A time applies to its date, so it needs a date first.
  const [from, setFrom] = useState(saved.from || '');
  const [to, setTo] = useState(saved.to || '');
  const [fromTime, setFromTime] = useState(saved.fromTime || '');
  const [toTime, setToTime] = useState(saved.toTime || '');
  const fromMs = from ? boundary(from, fromTime, false) : null;
  const toMs = to ? boundary(to, toTime, true) : null;
  // Search (PO number, order, customer, SKU…) and ordered / not ordered
  // (Sally, 15 Oct 2026: "a search bar ... enter the purchase order number").
  const [query, setQuery] = useState(saved.query || '');
  const [poState, setPoState] = useState<'all' | 'open' | 'ordered'>(
    saved.poState === 'open' || saved.poState === 'ordered' ? saved.poState : 'all',
  );
  useEffect(() => {
    try {
      sessionStorage.setItem(
        BO_FILTERS_KEY,
        JSON.stringify({ supplier, from, to, fromTime, toTime, query, poState } as BoFilters),
      );
    } catch {
      // storage blocked — filters just won't be remembered
    }
  }, [supplier, from, to, fromTime, toTime, query, poState]);
  // The supplier counts as a filter too, so Clear filters resets it (Sally,
  // 11 Nov 2026).
  const filtered = !!(from || to || fromTime || toTime || query.trim() || poState !== 'all' || supplier !== 'all');
  const clearFilters = () => {
    setFrom('');
    setTo('');
    setFromTime('');
    setToTime('');
    setQuery('');
    setPoState('all');
    setSupplier('all');
  };
  const [printing, setPrinting] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [poFor, setPoFor] = useState<{ supplier: string; lines: BoLine[] } | null>(null);

  const q = query.trim().toLowerCase();
  // The supplier counts too (Sally, 4 Nov 2026: searching "Vencha" found
  // only the POS line with Vencha in its name; the website lines under the
  // Vencha heading don't say it).
  const matches = (l: BoLine, supplierName: string) => {
    const t = new Date(l.orderedAt).getTime();
    if (fromMs != null && t < fromMs) return false;
    if (toMs != null && t > toMs) return false;
    if (poState === 'open' && l.poNumber) return false;
    if (poState === 'ordered' && !l.poNumber) return false;
    if (!q) return true;
    return [supplierName, l.poNumber, l.orderNumber, l.customer, l.company, l.sku, l.name, l.phone]
      .some((v) => String(v || '').toLowerCase().includes(q));
  };

  // Filters first, then regroup totals so cards / headers / PO match them.
  const dated: BoGroup[] = (data?.suppliers || [])
    .map((g) => {
      const lines = g.lines.filter((l) => matches(l, g.supplier));
      return {
        ...g,
        lines,
        units: lines.reduce((s, l) => s + l.qty, 0),
        value: Math.round(lines.reduce((s, l) => s + l.value, 0) * 100) / 100,
        costEx: Math.round(lines.reduce((s, l) => s + (l.costEx || 0), 0) * 100) / 100,
        linesWithoutCost: lines.filter((l) => l.costEx == null).length,
      };
    })
    .filter((g) => g.lines.length > 0);
  const groups = dated.filter((g) => supplier === 'all' || g.supplier === supplier);
  const all = groups.flatMap((g) => g.lines);
  const sum = {
    suppliers: groups.length,
    lines: all.length,
    units: all.reduce((s, l) => s + l.qty, 0),
    value: groups.reduce((s, g) => s + g.value, 0),
    costEx: groups.reduce((s, g) => s + g.costEx, 0),
    missing: groups.reduce((s, g) => s + g.linesWithoutCost, 0),
    oldestDays: all.length ? Math.max(...all.map((l) => l.daysWaiting)) : 0,
    notOrdered: all.filter((l) => !l.poNumber).length,
  };

  const toggle = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  // Create PO for one supplier: the ticked lines of that supplier, or —
  // when none are ticked — every line of theirs not ordered yet.
  const startPo = (g: BoGroup) => {
    const ticked = g.lines.filter((l) => selected.has(l.lineId));
    const lines = ticked.length ? ticked : g.lines.filter((l) => !l.poNumber);
    if (lines.length === 0) {
      toast('Everything for this supplier is already on a PO — tick lines to order them again');
      return;
    }
    setPoFor({ supplier: g.supplier, lines });
  };

  // Move a line to the supplier it's really ordered from (Sally, 20 Oct
  // 2026: "Pico glass ... we know that's Vencha").
  const [supplierNames, setSupplierNames] = useState<string[]>([]);
  useEffect(() => {
    if (readOnly) return;
    reportsApi.supplierNames().then((r) => setSupplierNames(r.data?.data || [])).catch(() => undefined);
  }, [readOnly]);
  const moveSupplier = async (l: BoLine, to: string) => {
    if (!to) return;
    try {
      await reportsApi.setBackorderSupplier(l.lineId, to);
      toast.success(`${l.sku} moved to ${to}`);
      reload();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  // Complete the ticked lines of one supplier (Sally, 11 Nov 2026: stock
  // came in but the lines were never marked, so they pile up here). Same
  // as the order screen: POS lines become Complete (taken), website lines
  // Complete. Nothing happens with no lines ticked.
  const [completing, setCompleting] = useState<string | null>(null);
  const completeLines = async (g: BoGroup) => {
    const lines = g.lines.filter((l) => selected.has(l.lineId));
    if (lines.length === 0) {
      toast('Tick the lines to take off back orders first');
      return;
    }
    const web = lines.filter((l) => l.source === 'magento').length;
    const pos = lines.length - web;
    const orders = new Set(lines.map((l) => l.orderId)).size;
    const what = [pos ? `${pos} in-store` : '', web ? `${web} website` : ''].filter(Boolean).join(' and ');
    if (!window.confirm(
      `Complete ${lines.length} ${g.supplier} line${lines.length === 1 ? '' : 's'} (${what}, on ${orders} order${orders === 1 ? '' : 's'})?\n\n` +
      'They come off Back Orders, the same as Complete on the order screen. Stock and payments don\'t change, ' +
      'an order with money still owing stays open for payment, and each order\'s history shows who did it.',
    )) return;
    setCompleting(g.supplier);
    try {
      const res = await reportsApi.completeBackorderLines(lines.map((l) => l.lineId));
      const r = res.data?.data || {};
      const failed: Array<{ lineId: number; orderNumber: string; sku: string; reason: string }> = r.failed || [];
      if (r.completed) {
        toast.success(`${r.completed} line${r.completed === 1 ? '' : 's'} completed on ${r.orders} order${r.orders === 1 ? '' : 's'}`);
      }
      if (r.alreadyClosed) {
        toast(`${r.alreadyClosed} line${r.alreadyClosed === 1 ? ' was' : 's were'} already off back order`);
      }
      if (failed.length) {
        toast.error(
          `${failed.length} not completed: ` +
            failed.slice(0, 3).map((f) => `${f.orderNumber} ${f.sku} — ${f.reason}`).join('; ') +
            (failed.length > 3 ? '…' : ''),
          { duration: 10000 },
        );
      }
      setSelected((prev) => {
        const next = new Set(prev);
        lines.forEach((l) => next.delete(l.lineId));
        failed.forEach((f) => next.add(f.lineId)); // left ticked to try again
        return next;
      });
      reload();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setCompleting(null);
    }
  };

  const unorder = async (l: BoLine) => {
    if (!window.confirm(
      `Take ${l.qty}× ${l.sku} (${l.orderNumber}) off PO ${l.poNumber}?\n\n` +
      'It goes back to "Not ordered", so it can go on a new PO later. The order gets a note.',
    )) return;
    try {
      await reportsApi.unorderBackorderLine(l.lineId);
      toast.success(`${l.sku} is back to not ordered`);
      reload();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const lineCols: Col<BoLine>[] = [
    ...(readOnly
      ? []
      : [
          {
            key: 'sel', label: '', value: () => '',
            render: (r: BoLine) => (
              <input
                type="checkbox"
                className="w-4 h-4"
                checked={selected.has(r.lineId)}
                onChange={() => toggle(r.lineId)}
                title="Tick to put on a PO, or to Complete"
              />
            ),
          } as Col<BoLine>,
        ]),
    {
      key: 'o', label: 'Order', value: (r) => r.orderNumber,
      // Opens the order screen (Sally, 15 Oct 2026: "instead of it popping
      // up as a PDF ... this screen comes up instead").
      render: (r) => (
        <button
          type="button"
          className="text-primary-400 font-semibold hover:underline whitespace-nowrap"
          title="Open this order"
          onClick={() =>
            navigate('/orders', {
              state: { openOrderId: r.orderId, returnTo: { path: '/reports', tab: 'backorders' } },
            })
          }
        >
          {r.orderNumber}
          {r.source === 'magento' && (
            <span className="ml-1 px-1 py-0.5 rounded text-[9px] font-bold uppercase bg-blue-600/20 text-blue-400 align-middle">
              Web
            </span>
          )}
        </button>
      ),
    },
    { key: 'd', label: 'Ordered', value: (r) => r.orderedAt, render: (r) => dateTime(r.orderedAt) },
    {
      key: 'w', label: 'Waiting', align: 'right', value: (r) => r.daysWaiting,
      render: (r) => <span className={r.daysWaiting > 30 ? 'text-red-500 font-semibold' : r.daysWaiting > 14 ? 'text-amber-500' : ''}>{r.daysWaiting} days</span>,
    },
    { key: 'c', label: 'Customer', value: (r) => r.customer + (r.company ? ` (${r.company})` : '') },
    { key: 'p', label: 'Phone', value: (r) => formatPhone(r.phone) },
    { key: 'sku', label: 'SKU', value: (r) => r.sku },
    {
      key: 'n', label: 'Product', value: (r) => r.name,
      render: (r) => (
        <div>
          <div>{r.name}</div>
          {r.webComment && (
            <div className="mt-0.5 text-xs text-blue-400" title="Latest comment on this order in Magento">
              Magento: {r.webComment}
              {r.webCommentAt && <span className="text-gray-500"> · {dateTime(r.webCommentAt)}</span>}
            </div>
          )}
        </div>
      ),
    },
    ...(readOnly
      ? []
      : [
          {
            key: 'mv', label: 'Supplier', value: () => '',
            render: (r: BoLine) => (
              <select
                className="input py-0.5 px-1 text-xs w-32"
                value=""
                title="Move this line to another supplier"
                onChange={(e) => moveSupplier(r, e.target.value)}
              >
                <option value="">Move to…</option>
                {supplierNames.map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            ),
          } as Col<BoLine>,
        ]),
    { key: 'q', label: 'Qty', align: 'right', value: (r) => r.qty },
    {
      key: 'uc', label: 'Unit cost ex GST', align: 'right', value: (r) => r.unitCostEx ?? '',
      render: (r) =>
        r.unitCostEx != null ? (
          <span className="whitespace-nowrap">
            {money(r.unitCostEx)}
            {r.bulkApplied && (
              <span
                className="ml-1 px-1 rounded text-[9px] font-bold uppercase bg-green-600/20 text-green-500"
                title={`Bulk buy price — ${r.bulkMinQty}+ on order (normally ${money(r.standardCostEx ?? null)})`}
              >
                bulk
              </span>
            )}
          </span>
        ) : (
          <span className="text-gray-500">—</span>
        ),
    },
    {
      key: 'tc', label: 'Cost ex GST', align: 'right', value: (r) => r.costEx ?? '',
      render: (r) => (r.costEx != null ? money(r.costEx) : <span className="text-gray-500">—</span>),
    },
    { key: 'v', label: 'Sell value', align: 'right', value: (r) => r.value, render: (r) => money(r.value) },
    {
      key: 'po', label: 'PO', value: (r) => r.poNumber || '',
      // Click the PO number to put the line back to "not ordered" (Sally,
      // 20 Oct 2026: supplier can't supply; order again later or refund).
      render: (r) =>
        r.poNumber ? (
          <span className="whitespace-nowrap">
            {readOnly ? (
              <span className="font-semibold text-green-500">{r.poNumber}</span>
            ) : (
              <button
                type="button"
                className="font-semibold text-green-500 hover:text-red-500 hover:line-through"
                title="Click to take this line off the PO — back to not ordered"
                onClick={() => unorder(r)}
              >
                {r.poNumber}
              </button>
            )}
            {r.poSentAt && <span className="text-xs text-gray-500"> · {dateOnly(r.poSentAt)}</span>}
          </span>
        ) : (
          <span className="text-xs text-amber-500 whitespace-nowrap">Not ordered</span>
        ),
    },
  ];
  const csvCols = lineCols.filter((c) => c.key !== 'sel');
  const exportAll = () =>
    downloadCsv(
      'backorders-by-supplier.csv',
      ['Supplier', ...csvCols.map((c) => c.label)],
      groups.flatMap((g) => g.lines.map((l) => [g.supplier, ...csvCols.map((c) => (c.value ? c.value(l) : ''))])),
    );
  const groupTitle = (g: BoGroup) => {
    const ticked = g.lines.filter((l) => selected.has(l.lineId)).length;
    const allTicked = ticked === g.lines.length;
    return (
      <div className="flex flex-wrap items-center gap-3">
        <span>
          {g.supplier} — {g.lines.length} lines, {int(g.units)} units, cost {money(g.costEx)} ex GST
          {g.linesWithoutCost ? ` (${g.linesWithoutCost} without a cost)` : ''} · sell {money(g.value)}
        </span>
        {!readOnly && (
          <span className="flex gap-2 ml-auto">
            <button
              type="button"
              className="btn-secondary btn-sm"
              onClick={() =>
                setSelected((prev) => {
                  const next = new Set(prev);
                  g.lines.forEach((l) => (allTicked ? next.delete(l.lineId) : next.add(l.lineId)));
                  return next;
                })
              }
            >
              {allTicked ? 'Untick all' : 'Tick all'}
            </button>
            <button type="button" className="btn-primary btn-sm" onClick={() => startPo(g)}>
              Create PO{ticked ? ` (${ticked})` : ''}
            </button>
            <button
              type="button"
              className="btn btn-sm bg-green-600 hover:bg-green-700 text-white disabled:opacity-50"
              disabled={!ticked || completing !== null}
              title={ticked ? 'Take the ticked lines off back orders' : 'Tick the lines to take off back orders'}
              onClick={() => completeLines(g)}
            >
              {completing === g.supplier ? 'Completing…' : `Complete${ticked ? ` (${ticked})` : ''}`}
            </button>
          </span>
        )}
      </div>
    );
  };
  return (
    <State loading={loading} error={error}>
      {data && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
            <StatCard label="Suppliers" value={int(sum.suppliers)} />
            <StatCard
              label="Lines on backorder"
              value={int(sum.lines)}
              sub={sum.notOrdered ? `${sum.notOrdered} not ordered yet` : 'all on a PO'}
            />
            <StatCard label="Units" value={int(sum.units)} />
            <StatCard
              label="Cost (ex GST)"
              value={money(sum.costEx)}
              sub={sum.missing ? `${sum.missing} line${sum.missing === 1 ? '' : 's'} without a cost` : undefined}
            />
            <StatCard label="Sell value" value={money(sum.value)} />
            <StatCard label="Longest wait" value={`${int(sum.oldestDays)} days`} tone={sum.oldestDays > 30 ? 'bad' : undefined} />
          </div>
          <div className="card p-4 flex flex-wrap items-end gap-3">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Search</label>
              <input
                className="input w-72"
                value={query}
                placeholder="Supplier, PO number, order, customer, SKU…"
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Ordered from supplier?</label>
              <select className="input w-44" value={poState} onChange={(e) => setPoState(e.target.value as any)}>
                <option value="all">All lines</option>
                <option value="open">Not ordered yet</option>
                <option value="ordered">Ordered (on a PO)</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Supplier</label>
              <select className="input w-56" value={supplier} onChange={(e) => setSupplier(e.target.value)}>
                <option value="all">All suppliers</option>
                {dated.map((g) => (
                  <option key={g.supplier} value={g.supplier}>{g.supplier} ({g.lines.length})</option>
                ))}
                {supplier !== 'all' && !dated.some((g) => g.supplier === supplier) && (
                  <option value={supplier}>{supplier} (0)</option>
                )}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Ordered from</label>
              <div className="flex gap-1">
                <input
                  type="date"
                  className="input"
                  value={from}
                  max={to || undefined}
                  onChange={(e) => {
                    setFrom(e.target.value);
                    if (!e.target.value) setFromTime('');
                  }}
                />
                <input
                  type="time"
                  className="input w-32"
                  value={fromTime}
                  disabled={!from}
                  title={from ? 'From this time (optional)' : 'Pick a date first'}
                  onChange={(e) => setFromTime(e.target.value)}
                />
              </div>
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">to</label>
              <div className="flex gap-1">
                <input
                  type="date"
                  className="input"
                  value={to}
                  min={from || undefined}
                  onChange={(e) => {
                    setTo(e.target.value);
                    if (!e.target.value) setToTime('');
                  }}
                />
                <input
                  type="time"
                  className="input w-32"
                  value={toTime}
                  disabled={!to}
                  title={to ? 'Up to this time (optional)' : 'Pick a date first'}
                  onChange={(e) => setToTime(e.target.value)}
                />
              </div>
            </div>
            {!readOnly && (
              <button className="btn-secondary" onClick={exportAll} disabled={!groups.length}>Export CSV</button>
            )}
            <button className="btn-secondary" onClick={() => setPrinting(true)} disabled={!groups.length}>Print</button>
            <button className="btn-secondary" onClick={reload}>Refresh</button>
            {/* Always here, after Refresh, so it doesn't appear and push the
                other buttons along (Sally, 11 Nov 2026: "Could the button
                be here?"). */}
            <button
              className="btn-secondary disabled:opacity-50"
              onClick={clearFilters}
              disabled={!filtered}
              title={filtered ? 'Clear the search, supplier, dates and times' : 'No filters set'}
            >
              Clear filters
            </button>
          </div>
          {groups.length === 0 && (
            <div className="card p-6 text-gray-400">
              {filtered ? 'No backorders match those filters.' : 'Nothing on backorder.'}
            </div>
          )}
          {groups.map((g) => (
            <DataTable
              key={g.supplier}
              title={groupTitle(g)}
              rows={g.lines}
              columns={lineCols}
            />
          ))}
          <Note>
            Open backorder items that haven't been marked received, oldest first. The supplier comes from the supplier price list the SKU is on,
            otherwise the product's brand; custom items with no supplier show under Unknown supplier. Cost is ex GST — the product's
            current cost, else the cost when it was sold, else the supplier price list.
            {!readOnly && (
              <>
                {' '}To order from a supplier: tick the lines (or tick none to take everything not ordered yet), click Create PO,
                then download / print it and click Mark as sent — the lines show the PO number and each customer's order gets an
                internal note. To clear lines that have been dealt with, tick them and click Complete: they come off this list, the
                same as Complete on the order screen. Stock and payments don't change.
              </>
            )}
          </Note>
          {poFor && (
            <PurchaseOrderEditor
              supplier={poFor.supplier}
              lines={poFor.lines.map((l) => ({
                lineId: l.lineId,
                sku: l.sku,
                name: l.name,
                qty: l.qty,
                unitCostEx: l.standardCostEx ?? l.unitCostEx,
                bulkCostEx: l.bulkCostEx ?? null,
                bulkMinQty: l.bulkMinQty ?? null,
                customer: l.customer,
                company: l.company,
                orderNumber: l.orderNumber,
              }))}
              onClose={() => setPoFor(null)}
              onMarkedSent={() => {
                setSelected(new Set());
                setPoFor(null);
                reload();
              }}
            />
          )}
          {printing && (
            <PrintSheet title="Backorders by supplier" onClose={() => setPrinting(false)}>
              <p className="mb-4 text-gray-600">
                Australian Lighting & Fans · printed {dateTime(new Date().toISOString())}
                {(from || to) && (
                  <>
                    {' '}· ordered {from ? `${dateOnly(from)}${fromTime ? ` ${fmtTime(fromTime)}` : ''}` : 'any time'} to{' '}
                    {to ? `${dateOnly(to)}${toTime ? ` ${fmtTime(toTime)}` : ''}` : 'now'}
                  </>
                )}
              </p>
              {groups.map((g) => (
                <div key={g.supplier} className="mb-5">
                  <h3 className="font-bold border-b border-gray-400 mb-1">
                    {g.supplier} — {g.lines.length} lines, {int(g.units)} units, cost {money(g.costEx)} ex GST
                  </h3>
                  <table className="w-full text-xs">
                    <thead><tr className="text-left">
                      <th className="py-1">Order</th><th>Ordered</th><th>Customer</th><th>Phone</th><th>SKU</th><th>Product</th>
                      <th className="text-right">Qty</th><th className="text-right">Cost ex GST</th><th>PO</th>
                    </tr></thead>
                    <tbody>
                      {g.lines.map((l) => (
                        <tr key={l.lineId} className="border-t border-gray-200">
                          <td className="py-1">{l.orderNumber}</td><td>{dateTime(l.orderedAt)}</td><td>{l.customer}</td>
                          <td>{formatPhone(l.phone)}</td><td>{l.sku}</td><td>{l.name}</td><td className="text-right">{l.qty}</td>
                          <td className="text-right">{l.costEx != null ? money(l.costEx) : '—'}</td>
                          <td>{l.poNumber || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </PrintSheet>
          )}
        </div>
      )}
    </State>
  );
}

// ============================================================ DISCOUNTS / QUOTES (existing)
const oldParams = (p: ReportRange) => ({ dateFrom: `${p.from} 00:00:00`, dateTo: `${p.to} 23:59:59` });

function Discounts({ params }: { params: ReportRange }) {
  const key = JSON.stringify(params);
  const { data, loading, error } = useReport<any[]>(() => reportsApi.getDiscountReport(oldParams(params)), [key]);
  return (
    <State loading={loading} error={error}>
      <DataTable
        title="Discounts by role and type"
        csvName={`discounts-${params.from}-to-${params.to}.csv`}
        rows={data || []}
        columns={[
          { key: 'role', label: 'Role', value: (r: any) => String(r.userRole || '').replace(/_/g, ' ') },
          { key: 'type', label: 'Type', value: (r: any) => r.discountType },
          { key: 'n', label: 'Times used', align: 'right', value: (r: any) => Number(r.usageCount), render: (r: any) => int(Number(r.usageCount)) },
          { key: 't', label: 'Total discount', align: 'right', value: (r: any) => Number(r.totalDiscount), render: (r: any) => money(Number(r.totalDiscount)) },
          { key: 'a', label: 'Average %', align: 'right', value: (r: any) => Number(r.avgDiscountPercent), render: (r: any) => pct(Number(r.avgDiscountPercent)) },
        ]}
      />
    </State>
  );
}

function Quotes({ params }: { params: ReportRange }) {
  const key = JSON.stringify(params);
  const { data, loading, error } = useReport<any>(() => reportsApi.getQuotesReport(oldParams(params)), [key]);
  const conv = data?.conversionRate;
  const rate = conv && Number(conv.total) ? (Number(conv.converted) / Number(conv.total)) * 100 : null;
  return (
    <State loading={loading} error={error}>
      {data && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
            <StatCard label="Quotes created" value={int(Number(conv?.total || 0))} />
            <StatCard label="Converted to sales" value={int(Number(conv?.converted || 0))} />
            <StatCard label="Conversion rate" value={pct(rate)} />
          </div>
          <DataTable
            title="Quotes by status"
            csvName={`quotes-${params.from}-to-${params.to}.csv`}
            rows={data.byStatus || []}
            columns={[
              { key: 's', label: 'Status', value: (r: any) => r.status },
              { key: 'n', label: 'Quotes', align: 'right', value: (r: any) => Number(r.count), render: (r: any) => int(Number(r.count)) },
              { key: 'v', label: 'Value', align: 'right', value: (r: any) => Number(r.totalValue), render: (r: any) => money(Number(r.totalValue)) },
            ]}
          />
        </div>
      )}
    </State>
  );
}
