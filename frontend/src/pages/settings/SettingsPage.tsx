import { useState, useEffect } from 'react';
import { settingsApi, syncApi, productsApi } from '../../services/api';
import type { AutoSyncConfig, AutoSyncState } from '../../services/api';
import { setCachedMinMarginPercent } from '../../utils/pricingConfig';
import {
  BuildingStorefrontIcon,
  CreditCardIcon,
  UserGroupIcon,
  Cog6ToothIcon,
  ClockIcon,
  ArrowPathIcon,
  ArrowLeftIcon,
  ScissorsIcon,
  TagIcon,
} from '@heroicons/react/24/outline';

interface Role {
  id: number;
  name: string;
  displayName: string;
  maxDiscountPercent: number;
  canStackDiscounts: boolean;
}

// Mirrors the backend trade-rules.defaults.ts shape.
interface TradeRule {
  id: number;
  label: string;
  percent: number;
  matchType: 'category' | 'category_name' | 'all_except_prefix' | 'all';
  categoryId?: number | null;
  categoryName?: string | null;
  excludeNamePrefix?: string | null;
  baseOnSpecialPrice?: boolean;
  excludeClearance?: boolean;
  enabled: boolean;
}

// Mirrors the backend led-strip.defaults.ts shape.
interface LedStripProduct {
  id: string;
  name: string;
  retailPerM: number;
  tradePerM: number;
  cutMm: number;
  maxRunM: number;
  includedTailM: number;
  tailPerM: number;
}

interface TradingHours {
  [key: string]: { open: string; close: string; closed: boolean };
}

const defaultTradingHours: TradingHours = {
  monday: { open: '09:00', close: '17:30', closed: false },
  tuesday: { open: '09:00', close: '17:30', closed: false },
  wednesday: { open: '09:00', close: '17:30', closed: false },
  thursday: { open: '09:00', close: '21:00', closed: false },
  friday: { open: '09:00', close: '17:30', closed: false },
  saturday: { open: '09:00', close: '17:00', closed: false },
  sunday: { open: '10:00', close: '16:00', closed: false },
};

// Website orders brought into the POS every 15 minutes, view-only (Sally,
// 16 Oct 2026: "when can website sales come across to POS ... can only be
// viewed and make no changes to invoice").
type WebsiteOrdersState = {
  enabled: boolean;
  syncedUntil: string | null;
  running: boolean;
  progress: { processed: number; fetched: number; created: number; updated: number; errors: number; message: string };
  lastRunAt: string | null;
  lastResult: { success: boolean; message: string } | null;
};

function WebsiteOrdersCard() {
  const [state, setState] = useState<WebsiteOrdersState | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [saving, setSaving] = useState(false);
  const load = async () => {
    try {
      const r = await syncApi.getWebsiteOrders();
      setState(r.data.data);
      setUnavailable(false);
    } catch {
      setUnavailable(true);
    }
  };
  useEffect(() => {
    load();
  }, []);
  // Follow an import while it runs.
  useEffect(() => {
    if (!state?.running) return;
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [state?.running]);

  const toggle = async () => {
    if (!state) return;
    setSaving(true);
    try {
      const r = await syncApi.setWebsiteOrders(!state.enabled);
      setState(r.data.data);
    } finally {
      setSaving(false);
    }
  };
  const importNow = async () => {
    setSaving(true);
    try {
      await syncApi.importWebsiteOrders();
      setState((s) => (s ? { ...s, running: true } : s));
      setTimeout(load, 1000);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="card p-6">
      <h2 className="text-lg font-semibold mb-1">Website Orders</h2>
      <p className="text-sm text-gray-400 mb-4">
        Brings orders placed on the website into the POS every 15 minutes (new orders, and status or
        refund changes to earlier ones). They show under Orders with an M2 badge and are view-only —
        payments, refunds and changes are made in Magento. They're not counted in the in-store reports
        (pick "Website orders" there to see them).
      </p>
      {unavailable || !state ? (
        <div className="text-gray-400 text-sm">{unavailable ? 'Unavailable — backend needs updating.' : 'Loading…'}</div>
      ) : (
        <div className="space-y-3 text-sm">
          <div className="flex flex-wrap items-center gap-3">
            <button
              className={`px-4 py-2 rounded-lg font-medium ${state.enabled ? 'bg-green-600 text-white' : 'bg-pos-accent text-gray-300'}`}
              onClick={toggle}
              disabled={saving}
            >
              {state.enabled ? 'On — every 15 minutes' : 'Off'}
            </button>
            <button className="btn-secondary" onClick={importNow} disabled={saving || state.running}>
              {state.running ? 'Importing…' : 'Import new website orders now'}
            </button>
          </div>
          {state.running && (
            <p className="text-gray-300">
              {state.progress.message} ({state.progress.processed}/{state.progress.fetched} done,{' '}
              {state.progress.created} new, {state.progress.updated} updated)
            </p>
          )}
          {state.lastRunAt && !state.running && (
            <p className="text-gray-400">
              Last run {new Date(state.lastRunAt).toLocaleString()}
              {state.lastResult && (
                <span className={state.lastResult.success ? 'text-green-400' : 'text-amber-400'}>
                  {' '}— {state.lastResult.message}
                </span>
              )}
            </p>
          )}
          {state.syncedUntil && (
            <p className="text-gray-500 text-xs">
              Up to date with Magento as of {new Date(state.syncedUntil.replace(' ', 'T') + 'Z').toLocaleString()}.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<'store' | 'payments' | 'roles' | 'system' | 'sync' | 'ledstrip' | 'trade'>('store');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');

  // Store settings
  const [storeSettings, setStoreSettings] = useState({
    store_name: '',
    store_abn: '',
    store_address: '',
    store_phone: '',
    store_email: '',
    tax_rate: 0.1,
    quote_expiry_days: 14,
    trading_hours: defaultTradingHours,
  });

  // Payment settings
  const [paymentSettings, setPaymentSettings] = useState({
    payment_cash_enabled: true,
    payment_eftpos_enabled: true,
    payment_credit_card_enabled: true,
    payment_store_credit_enabled: true,
    default_payment_method: 'cash',
  });

  // Roles
  const [roles, setRoles] = useState<Role[]>([]);
  const [editingRole, setEditingRole] = useState<Role | null>(null);

  // System settings
  const [systemSettings, setSystemSettings] = useState({
    receipt_print_enabled: true,
    receipt_logo_url: '',
    receipt_footer_text: 'Thank you for shopping with us!',
    default_stock_hold: false,
    offline_mode_enabled: false,
  });

  // LED strip cut-to-length rates (Strip Cut Counter). Editable here so
  // Sally can adjust strip/tail pricing without a deploy.
  const [stripProducts, setStripProducts] = useState<LedStripProduct[]>([]);

  // Trade auto-discount rules — the % a trade customer gets off, and
  // what each rule applies to. Defaults kept alongside so an older
  // saved rule-set can be restored to the shipped configuration.
  const [tradeRules, setTradeRules] = useState<TradeRule[]>([]);
  // Last day all trade rules are off ('' = not paused) — Black Friday 2026.
  const [tradePausedUntil, setTradePausedUntil] = useState('');
  const [tradeRuleDefaults, setTradeRuleDefaults] = useState<TradeRule[]>([]);
  // Minimum margin over cost (Sally, 29 Sep 2026: 30% -> 20%).
  const [minMarginInput, setMinMarginInput] = useState('20');
  const [minMarginSaving, setMinMarginSaving] = useState(false);
  const [minMarginMsg, setMinMarginMsg] = useState<{ ok: boolean; text: string } | null>(null);
  // Checkout promotion (fans 10% in Oct 2026, Black Friday from 1 Nov).
  const [promo, setPromo] = useState<{
    enabled: boolean;
    label: string;
    percent: number;
    includeCategories: string[];
    excludeCategories: string[];
    excludePrefixes: string[];
    excludeOnSale: boolean;
    endsOn: string | null;
    discountUntil: string | null;
    showBanner: boolean;
    bannerText: string;
  } | null>(null);
  const [promoSummary, setPromoSummary] = useState<Record<string, number> | null>(null);
  const [promoPrefixes, setPromoPrefixes] = useState('');
  const [promoSaving, setPromoSaving] = useState(false);
  const [promoMsg, setPromoMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // Sync state
  const [syncStatus, setSyncStatus] = useState<{
    lastSync: string | null;
    lastSyncStatus?: string | null;
    lastSyncType?: string | null;
    lastSyncFailed?: number;
    lastSuccessfulSync?: string | null;
    productCount: number;
    categoryCount: number;
    customerCount: number;
  } | null>(null);
  const [syncRunning, setSyncRunning] = useState<string | null>(null);
  // Automatic product sync schedule (Sally, 10 Sep). `autoSyncDraft` is
  // what the controls show; `autoSync` is the saved state from the server.
  const [autoSync, setAutoSync] = useState<AutoSyncState | null>(null);
  const [autoSyncDraft, setAutoSyncDraft] = useState<AutoSyncConfig>({
    mode: 'off',
    intervalMinutes: 15,
    dailyTime: '06:00',
  });
  const [autoSyncSaving, setAutoSyncSaving] = useState(false);
  const [syncResult, setSyncResult] = useState<{ success: boolean; message: string } | null>(null);
  // Live progress of the current/last background sync (categories /
  // products / customers). Polled every 3s while the sync tab is open.
  const [liveProgress, setLiveProgress] = useState<{
    task: string;
    phase: string;
    current: number;
    total: number;
    startedAt: string;
    finishedAt: string | null;
    success: boolean | null;
    message: string | null;
    errors?: string[];
  } | null>(null);
  const [showSyncErrors, setShowSyncErrors] = useState(false);

  useEffect(() => {
    fetchSettings();
  }, [activeTab]);

  const fetchSettings = async () => {
    setIsLoading(true);
    try {
      switch (activeTab) {
        case 'store':
          const storeRes = await settingsApi.getStoreSettings();
          const storeData = storeRes.data.data;
          setStoreSettings({
            store_name: storeData.store_name || '',
            store_abn: storeData.store_abn || '',
            store_address: storeData.store_address || '',
            store_phone: storeData.store_phone || '',
            store_email: storeData.store_email || '',
            tax_rate: storeData.tax_rate || 0.1,
            quote_expiry_days: storeData.quote_expiry_days || 14,
            trading_hours: storeData.trading_hours || defaultTradingHours,
          });
          break;
        case 'payments':
          const payRes = await settingsApi.getPaymentSettings();
          setPaymentSettings(payRes.data.data);
          break;
        case 'roles':
          const rolesRes = await settingsApi.getRoles();
          setRoles(rolesRes.data.data.roles);
          break;
        case 'system':
          const sysRes = await settingsApi.getSystemSettings();
          setSystemSettings(sysRes.data.data);
          break;
        case 'ledstrip':
          const stripRes = await settingsApi.getLedStripProducts();
          setStripProducts(stripRes.data.data.products || []);
          break;
        case 'trade':
          const tradeRes = await productsApi.getTradeRules();
          setTradeRules(tradeRes.data.data.rules || []);
          setTradePausedUntil(tradeRes.data.data.pausedUntil || '');
          setTradeRuleDefaults(tradeRes.data.data.defaults || []);
          try {
            const cfg = await productsApi.getPricingConfig();
            setMinMarginInput(String(cfg.data?.data?.minMarginPercent ?? 20));
            try {
              const pr = await productsApi.getPromotion();
              setPromo(pr.data?.data?.promotion || null);
              setPromoSummary(pr.data?.data?.summary || null);
              setPromoPrefixes((pr.data?.data?.promotion?.excludePrefixes || []).join(', '));
            } catch {
              // older backend
            }
          } catch {
            // older backend — leave the default in the box
          }
          break;
        case 'sync':
          const statusRes = await syncApi.getStatus();
          setSyncStatus(statusRes.data.data);
          try {
            const autoRes = await syncApi.getAutoSync();
            setAutoSync(autoRes.data.data);
            setAutoSyncDraft(autoRes.data.data.config);
          } catch {
            // older backend without the schedule endpoint — card shows "unavailable"
          }
          break;
      }
    } catch (error) {
      console.error('Failed to fetch settings:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSaveStore = async () => {
    setIsSaving(true);
    setSaveMessage('');
    try {
      await settingsApi.updateStoreSettings(storeSettings);
      setSaveMessage('Store settings saved successfully!');
      setTimeout(() => setSaveMessage(''), 3000);
    } catch (error) {
      setSaveMessage('Failed to save settings');
    } finally {
      setIsSaving(false);
    }
  };

  const handleSavePayments = async () => {
    setIsSaving(true);
    setSaveMessage('');
    try {
      await settingsApi.updatePaymentSettings(paymentSettings);
      setSaveMessage('Payment settings saved successfully!');
      setTimeout(() => setSaveMessage(''), 3000);
    } catch (error) {
      setSaveMessage('Failed to save settings');
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveRole = async () => {
    if (!editingRole) return;
    setIsSaving(true);
    setSaveMessage('');
    try {
      await settingsApi.updateRole(editingRole.id, {
        displayName: editingRole.displayName,
        maxDiscountPercent: editingRole.maxDiscountPercent,
        canStackDiscounts: editingRole.canStackDiscounts,
      });
      setRoles(roles.map((r) => (r.id === editingRole.id ? editingRole : r)));
      setEditingRole(null);
      setSaveMessage('Role updated successfully!');
      setTimeout(() => setSaveMessage(''), 3000);
    } catch (error) {
      setSaveMessage('Failed to update role');
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveSystem = async () => {
    setIsSaving(true);
    setSaveMessage('');
    try {
      await settingsApi.updateSystemSettings(systemSettings);
      setSaveMessage('System settings saved successfully!');
      setTimeout(() => setSaveMessage(''), 3000);
    } catch (error) {
      setSaveMessage('Failed to save settings');
    } finally {
      setIsSaving(false);
    }
  };

  // Poll the live sync progress while the Magento Sync tab is open;
  // when a run finishes, refresh the status cards once.
  useEffect(() => {
    if (activeTab !== 'sync') return;
    let prevFinished: string | null | undefined;
    const tick = async () => {
      try {
        const r = await syncApi.getProgress();
        const p = r.data?.data ?? null;
        setLiveProgress(p);
        if (p?.finishedAt && prevFinished === null) {
          const s = await syncApi.getStatus();
          setSyncStatus(s.data.data);
          try {
            const a = await syncApi.getAutoSync();
            setAutoSync(a.data.data);
          } catch {
            // ignore
          }
        }
        prevFinished = p?.finishedAt ?? undefined;
      } catch {
        // transient poll errors are fine
      }
    };
    tick();
    const iv = setInterval(tick, 3000);
    return () => clearInterval(iv);
  }, [activeTab]);

  const handleSavePromo = async () => {
    if (!promo) return;
    const pct = Number(promo.percent);
    if (!Number.isFinite(pct) || pct <= 0 || pct > 90) {
      setPromoMsg({ ok: false, text: 'Enter a percent between 1 and 90' });
      return;
    }
    setPromoSaving(true);
    setPromoMsg(null);
    try {
      const r = await productsApi.updatePromotion({
        ...promo,
        percent: pct,
        excludePrefixes: promoPrefixes,
        endsOn: promo.endsOn || null,
      });
      setPromo(r.data?.data?.promotion || promo);
      setPromoSummary(r.data?.data?.summary || null);
      setPromoPrefixes((r.data?.data?.promotion?.excludePrefixes || []).join(', '));
      setPromoMsg({ ok: true, text: r.data?.message || 'Saved' });
    } catch (e: any) {
      setPromoMsg({ ok: false, text: e.response?.data?.message || 'Failed to save the promotion' });
    } finally {
      setPromoSaving(false);
    }
  };

  const handleSaveMinMargin = async () => {
    const n = parseFloat(minMarginInput);
    if (!Number.isFinite(n) || n < 0 || n > 500) {
      setMinMarginMsg({ ok: false, text: 'Enter a percent between 0 and 500' });
      return;
    }
    setMinMarginSaving(true);
    setMinMarginMsg(null);
    try {
      const r = await productsApi.updatePricingConfig(n);
      const saved = Number(r.data?.data?.minMarginPercent ?? n);
      setMinMarginInput(String(saved));
      setCachedMinMarginPercent(saved);
      setMinMarginMsg({ ok: true, text: r.data?.message || 'Saved' });
    } catch (e: any) {
      setMinMarginMsg({
        ok: false,
        text: e.response?.data?.message || 'Failed to save the minimum margin',
      });
    } finally {
      setMinMarginSaving(false);
    }
  };

  const handleSaveAutoSync = async () => {
    setAutoSyncSaving(true);
    try {
      const r = await syncApi.updateAutoSync(autoSyncDraft);
      setAutoSync(r.data.data);
      setAutoSyncDraft(r.data.data.config);
      setSyncResult({ success: true, message: r.data.message || 'Schedule saved' });
    } catch (e: any) {
      setSyncResult({
        success: false,
        message: e.response?.data?.message || 'Failed to save the schedule',
      });
    } finally {
      setAutoSyncSaving(false);
    }
  };

  const handleSync = async (type: 'categories' | 'products' | 'customers' | 'orders' | 'push-orders' | 'stock' | 'full' | 'clear-and-sync') => {
    setSyncRunning(type);
    setSyncResult(null);

    // Orders sync runs in background on the server — poll for progress.
    if (type === 'orders') {
      try {
        await syncApi.syncOrders();
        setSyncResult({ success: true, message: 'Order sync started in background...' });

        const pollInterval = setInterval(async () => {
          try {
            const statusRes = await syncApi.getOrderSyncStatus();
            const progress = statusRes.data.data;
            setSyncResult({
              success: true,
              message: progress.running
                ? `${progress.message} (${progress.processed}/${progress.fetched} processed, ${progress.created} created, ${progress.updated} updated, ${progress.errors} errors)`
                : progress.message,
            });
            if (!progress.running) {
              clearInterval(pollInterval);
              setSyncRunning(null);
              const s = await syncApi.getStatus();
              setSyncStatus(s.data.data);
            }
          } catch {
            // ignore transient poll errors
          }
        }, 3000);
      } catch (error: any) {
        setSyncResult({
          success: false,
          message: error.response?.data?.message || error.message || 'Sync failed',
        });
        setSyncRunning(null);
      }
      return;
    }

    try {
      let res;
      switch (type) {
        case 'categories': res = await syncApi.syncCategories(); break;
        case 'products': res = await syncApi.syncProducts(); break;
        case 'customers': res = await syncApi.syncCustomers(); break;
        case 'push-orders': res = await syncApi.pushPendingPosOrders(); break;
        case 'stock': res = await syncApi.syncStock(); break;
        case 'full': res = await syncApi.fullSync(); break;
        case 'clear-and-sync': res = await syncApi.clearAndSync(); break;
      }
      setSyncResult({ success: res?.data.success, message: res?.data.message });
      // Refresh status
      const statusRes = await syncApi.getStatus();
      setSyncStatus(statusRes.data.data);
    } catch (error: any) {
      setSyncResult({
        success: false,
        message: error.response?.data?.message || error.message || 'Sync failed',
      });
    } finally {
      setSyncRunning(null);
    }
  };

  const updateTradingHours = (
    day: string,
    field: 'open' | 'close' | 'closed',
    value: string | boolean
  ) => {
    setStoreSettings({
      ...storeSettings,
      trading_hours: {
        ...storeSettings.trading_hours,
        [day]: {
          ...storeSettings.trading_hours[day],
          [field]: value,
        },
      },
    });
  };

  const handleSaveStripProducts = async () => {
    setIsSaving(true);
    setSaveMessage('');
    try {
      const res = await settingsApi.updateLedStripProducts(stripProducts);
      // Server normalises (clamps NaN / negative values) — take its copy
      // back so the form shows exactly what was stored.
      setStripProducts(res.data.data.products || stripProducts);
      setSaveMessage('LED strip pricing saved successfully!');
      setTimeout(() => setSaveMessage(''), 3000);
    } catch (error) {
      setSaveMessage('Failed to save LED strip pricing');
    } finally {
      setIsSaving(false);
    }
  };

  const handleResetStripProducts = async () => {
    try {
      const res = await settingsApi.getLedStripDefaults();
      setStripProducts(res.data.data.products || []);
      setSaveMessage('Defaults loaded — press Save to apply them.');
      setTimeout(() => setSaveMessage(''), 4000);
    } catch (error) {
      setSaveMessage('Failed to load defaults');
    }
  };

  const updateStripField = (
    id: string,
    field: keyof LedStripProduct,
    value: string,
  ) => {
    setStripProducts((prev) =>
      prev.map((p) =>
        p.id === id
          ? {
              ...p,
              [field]: field === 'name' ? value : parseFloat(value) || 0,
            }
          : p,
      ),
    );
  };

  const handleSaveTradeRules = async () => {
    setIsSaving(true);
    setSaveMessage('');
    try {
      const res = await productsApi.updateTradeRules(tradeRules, tradePausedUntil);
      setTradeRules(res.data.data.rules || tradeRules);
      setSaveMessage('Trade pricing rules saved successfully!');
      setTimeout(() => setSaveMessage(''), 3000);
    } catch (error) {
      setSaveMessage('Failed to save trade pricing rules');
    } finally {
      setIsSaving(false);
    }
  };

  const updateTradeRule = (
    id: number,
    field: keyof TradeRule,
    value: string | boolean,
  ) => {
    setTradeRules((prev) =>
      prev.map((r) => {
        if (r.id !== id) return r;
        if (field === 'percent') {
          const n = parseFloat(value as string);
          return { ...r, percent: Number.isFinite(n) ? n : 0 };
        }
        if (field === 'categoryId') {
          const n = parseInt(value as string, 10);
          return { ...r, categoryId: Number.isFinite(n) ? n : null };
        }
        return { ...r, [field]: value } as TradeRule;
      }),
    );
  };

  const tabs = [
    { id: 'store', label: 'Store', icon: BuildingStorefrontIcon },
    { id: 'payments', label: 'Payments', icon: CreditCardIcon },
    { id: 'roles', label: 'Roles', icon: UserGroupIcon },
    { id: 'trade', label: 'Trade Pricing', icon: TagIcon },
    { id: 'ledstrip', label: 'LED Strip', icon: ScissorsIcon },
    { id: 'system', label: 'System', icon: Cog6ToothIcon },
    { id: 'sync', label: 'Magento Sync', icon: ArrowPathIcon },
  ];

  const dayLabels: Record<string, string> = {
    monday: 'Monday',
    tuesday: 'Tuesday',
    wednesday: 'Wednesday',
    thursday: 'Thursday',
    friday: 'Friday',
    saturday: 'Saturday',
    sunday: 'Sunday',
  };

  return (
    <div className="h-full p-6 overflow-auto">
      <h1 className="text-2xl font-bold mb-6">Settings</h1>

      {/* Tabs */}
      <div className="flex gap-2 mb-6">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors ${
              activeTab === tab.id
                ? 'bg-primary-600 text-white'
                : 'bg-pos-accent text-gray-300 hover:bg-pos-accent/70'
            }`}
            onClick={() => setActiveTab(tab.id as any)}
          >
            <tab.icon className="h-5 w-5" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Save Message */}
      {saveMessage && (
        <div
          className={`mb-4 px-4 py-2 rounded ${
            saveMessage.includes('success')
              ? 'bg-green-600/20 text-green-400 border border-green-600'
              : 'bg-red-600/20 text-red-400 border border-red-600'
          }`}
        >
          {saveMessage}
        </div>
      )}

      {isLoading ? (
        <div className="card p-8 text-center text-gray-400">Loading settings...</div>
      ) : (
        <>
          {/* Store Settings */}
          {activeTab === 'store' && (
            <div className="space-y-6">
              <div className="card p-6">
                <h2 className="text-lg font-semibold mb-4">Store Information</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm text-gray-400 mb-1">Store Name</label>
                    <input
                      type="text"
                      className="input"
                      value={storeSettings.store_name}
                      onChange={(e) =>
                        setStoreSettings({ ...storeSettings, store_name: e.target.value })
                      }
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-400 mb-1">ABN</label>
                    <input
                      type="text"
                      className="input"
                      value={storeSettings.store_abn}
                      onChange={(e) =>
                        setStoreSettings({ ...storeSettings, store_abn: e.target.value })
                      }
                    />
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-sm text-gray-400 mb-1">Address</label>
                    <input
                      type="text"
                      className="input"
                      value={storeSettings.store_address}
                      onChange={(e) =>
                        setStoreSettings({ ...storeSettings, store_address: e.target.value })
                      }
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-400 mb-1">Phone</label>
                    <input
                      type="text"
                      className="input"
                      value={storeSettings.store_phone}
                      onChange={(e) =>
                        setStoreSettings({ ...storeSettings, store_phone: e.target.value })
                      }
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-400 mb-1">Email</label>
                    <input
                      type="email"
                      className="input"
                      value={storeSettings.store_email}
                      onChange={(e) =>
                        setStoreSettings({ ...storeSettings, store_email: e.target.value })
                      }
                    />
                  </div>
                </div>
              </div>

              <div className="card p-6">
                <h2 className="text-lg font-semibold mb-4">Tax & Quotes</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm text-gray-400 mb-1">GST Rate (%)</label>
                    <input
                      type="number"
                      className="input"
                      value={storeSettings.tax_rate * 100}
                      onChange={(e) =>
                        setStoreSettings({
                          ...storeSettings,
                          tax_rate: parseFloat(e.target.value) / 100,
                        })
                      }
                      min="0"
                      max="100"
                      step="0.1"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-400 mb-1">
                      Quote Expiry (days)
                    </label>
                    <input
                      type="number"
                      className="input"
                      value={storeSettings.quote_expiry_days}
                      onChange={(e) =>
                        setStoreSettings({
                          ...storeSettings,
                          quote_expiry_days: parseInt(e.target.value),
                        })
                      }
                      min="1"
                      max="90"
                    />
                  </div>
                </div>
              </div>

              <div className="card p-6">
                <div className="flex items-center gap-2 mb-4">
                  <ClockIcon className="h-5 w-5 text-primary-500" />
                  <h2 className="text-lg font-semibold">Trading Hours</h2>
                </div>
                <div className="space-y-3">
                  {Object.keys(dayLabels).map((day) => (
                    <div key={day} className="flex items-center gap-4">
                      <div className="w-28 text-gray-300">{dayLabels[day]}</div>
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={!storeSettings.trading_hours[day]?.closed}
                          onChange={(e) => updateTradingHours(day, 'closed', !e.target.checked)}
                          className="rounded bg-pos-dark border-gray-600"
                        />
                        <span className="text-sm text-gray-400">Open</span>
                      </label>
                      {!storeSettings.trading_hours[day]?.closed && (
                        <>
                          <input
                            type="time"
                            className="input w-32"
                            value={storeSettings.trading_hours[day]?.open || '09:00'}
                            onChange={(e) => updateTradingHours(day, 'open', e.target.value)}
                          />
                          <span className="text-gray-400">to</span>
                          <input
                            type="time"
                            className="input w-32"
                            value={storeSettings.trading_hours[day]?.close || '17:30'}
                            onChange={(e) => updateTradingHours(day, 'close', e.target.value)}
                          />
                        </>
                      )}
                      {storeSettings.trading_hours[day]?.closed && (
                        <span className="text-red-400">Closed</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex justify-end">
                <button
                  onClick={handleSaveStore}
                  disabled={isSaving}
                  className="btn-primary px-6"
                >
                  {isSaving ? 'Saving...' : 'Save Store Settings'}
                </button>
              </div>
            </div>
          )}

          {/* Payment Settings */}
          {activeTab === 'payments' && (
            <div className="space-y-6">
              <div className="card p-6">
                <h2 className="text-lg font-semibold mb-4">Payment Methods</h2>
                <div className="space-y-4">
                  <label className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      checked={paymentSettings.payment_cash_enabled}
                      onChange={(e) =>
                        setPaymentSettings({
                          ...paymentSettings,
                          payment_cash_enabled: e.target.checked,
                        })
                      }
                      className="rounded bg-pos-dark border-gray-600 h-5 w-5"
                    />
                    <span className="text-lg">Cash</span>
                  </label>
                  <label className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      checked={paymentSettings.payment_eftpos_enabled}
                      onChange={(e) =>
                        setPaymentSettings({
                          ...paymentSettings,
                          payment_eftpos_enabled: e.target.checked,
                        })
                      }
                      className="rounded bg-pos-dark border-gray-600 h-5 w-5"
                    />
                    <span className="text-lg">EFTPOS</span>
                  </label>
                  <label className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      checked={paymentSettings.payment_credit_card_enabled}
                      onChange={(e) =>
                        setPaymentSettings({
                          ...paymentSettings,
                          payment_credit_card_enabled: e.target.checked,
                        })
                      }
                      className="rounded bg-pos-dark border-gray-600 h-5 w-5"
                    />
                    <span className="text-lg">Credit Card</span>
                  </label>
                  <label className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      checked={paymentSettings.payment_store_credit_enabled}
                      onChange={(e) =>
                        setPaymentSettings({
                          ...paymentSettings,
                          payment_store_credit_enabled: e.target.checked,
                        })
                      }
                      className="rounded bg-pos-dark border-gray-600 h-5 w-5"
                    />
                    <span className="text-lg">Store Credit</span>
                  </label>
                </div>
              </div>

              <div className="card p-6">
                <h2 className="text-lg font-semibold mb-4">Default Payment Method</h2>
                <select
                  className="input w-full md:w-64"
                  value={paymentSettings.default_payment_method}
                  onChange={(e) =>
                    setPaymentSettings({
                      ...paymentSettings,
                      default_payment_method: e.target.value,
                    })
                  }
                >
                  <option value="cash">Cash</option>
                  <option value="eftpos">EFTPOS</option>
                  <option value="credit_card">Credit Card</option>
                  <option value="store_credit">Store Credit</option>
                </select>
              </div>

              <div className="flex justify-end">
                <button
                  onClick={handleSavePayments}
                  disabled={isSaving}
                  className="btn-primary px-6"
                >
                  {isSaving ? 'Saving...' : 'Save Payment Settings'}
                </button>
              </div>
            </div>
          )}

          {/* Role Settings */}
          {activeTab === 'roles' && (
            <div className="space-y-6">
              <div className="card overflow-hidden">
                <table className="w-full">
                  <thead className="bg-pos-accent">
                    <tr>
                      <th className="px-4 py-3 text-left text-sm font-medium text-gray-300">
                        Role
                      </th>
                      <th className="px-4 py-3 text-left text-sm font-medium text-gray-300">
                        Display Name
                      </th>
                      <th className="px-4 py-3 text-center text-sm font-medium text-gray-300">
                        Max Discount %
                      </th>
                      <th className="px-4 py-3 text-center text-sm font-medium text-gray-300">
                        Can Stack Discounts
                      </th>
                      <th className="px-4 py-3 text-center text-sm font-medium text-gray-300">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-700">
                    {roles.map((role) => (
                      <tr key={role.id}>
                        <td className="px-4 py-3 font-mono text-primary-400">{role.name}</td>
                        <td className="px-4 py-3">{role.displayName}</td>
                        <td className="px-4 py-3 text-center">
                          <span
                            className={`px-2 py-1 rounded text-sm ${
                              role.maxDiscountPercent >= 100
                                ? 'bg-green-600/20 text-green-400'
                                : role.maxDiscountPercent >= 20
                                ? 'bg-blue-600/20 text-blue-400'
                                : 'bg-yellow-600/20 text-yellow-400'
                            }`}
                          >
                            {role.maxDiscountPercent}%
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          {role.canStackDiscounts ? (
                            <span className="text-green-400">Yes</span>
                          ) : (
                            <span className="text-red-400">No</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <button
                            onClick={() => setEditingRole({ ...role })}
                            className="text-primary-400 hover:text-primary-300"
                          >
                            Edit
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="card p-6 bg-pos-accent/50">
                <h3 className="font-medium mb-2">Role Permissions Summary</h3>
                <div className="text-sm text-gray-400 space-y-1">
                  <p>
                    <strong className="text-yellow-400">Sales Staff:</strong> Can apply up to 10%
                    discount, cannot stack discounts
                  </p>
                  <p>
                    <strong className="text-blue-400">Manager:</strong> Can apply up to 20%
                    discount, can stack multiple discounts
                  </p>
                  <p>
                    <strong className="text-green-400">Admin:</strong> Unlimited discount authority,
                    full system access
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Trade auto-discount rules */}
          {activeTab === 'trade' && (
            <div className="space-y-6">
              {/* Checkout promotion (fans 10%, Oct 2026) — every customer. */}
              {promo && (
                <div className="card p-6">
                  <div className="flex items-center justify-between gap-4 mb-1">
                    <h2 className="text-lg font-semibold">Promotion: {promo.label}</h2>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="w-4 h-4"
                        checked={promo.enabled}
                        onChange={(e) => setPromo({ ...promo, enabled: e.target.checked })}
                      />
                      <span>{promo.enabled ? 'On' : 'Off'}</span>
                    </label>
                  </div>
                  <p className="text-sm text-gray-400 mb-4">
                    Comes off automatically at checkout for every customer, on{' '}
                    {promo.includeCategories.join(', ')} (not{' '}
                    {promo.excludeCategories.join(', ') || 'nothing'}).{' '}
                    {promo.excludeOnSale
                      ? 'Items on sale or in a Sale / Clearance category never get it.'
                      : 'Items with a special price get it off that price, as on the website.'}{' '}
                    Nothing goes below the minimum margin. Trade customers get whichever is
                    better: their trade price or this.
                  </p>
                  <label className="flex items-center gap-2 text-sm mb-4">
                    <input
                      type="checkbox"
                      className="w-4 h-4"
                      checked={promo.excludeOnSale}
                      onChange={(e) => setPromo({ ...promo, excludeOnSale: e.target.checked })}
                    />
                    Leave out anything already on sale (special price)
                  </label>
                  <div className="flex items-end gap-4 flex-wrap">
                    <div>
                      <label className="block text-sm font-medium mb-1">Discount</label>
                      <div className="relative">
                        <input
                          type="number"
                          min={1}
                          max={90}
                          step="0.5"
                          className="input w-28 pr-8"
                          value={promo.percent}
                          onChange={(e) => setPromo({ ...promo, percent: Number(e.target.value) })}
                        />
                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">%</span>
                      </div>
                    </div>
                    <div className="flex-1 min-w-[240px]">
                      <label className="block text-sm font-medium mb-1">
                        Exclude products whose name or SKU starts with
                      </label>
                      <input
                        type="text"
                        className="input w-full"
                        value={promoPrefixes}
                        onChange={(e) => setPromoPrefixes(e.target.value)}
                        placeholder="Iconic, Artemis, Sycamore"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">Last day (optional)</label>
                      <input
                        type="date"
                        className="input w-44"
                        value={promo.endsOn || ''}
                        onChange={(e) => setPromo({ ...promo, endsOn: e.target.value || null })}
                      />
                    </div>
                    <div>
                      <label
                        className="block text-sm font-medium mb-1"
                        title="From then the banner stays but nothing comes off at checkout — the sale prices come from Magento"
                      >
                        Checkout discount stops at
                      </label>
                      <input
                        type="datetime-local"
                        className="input w-56"
                        value={(promo.discountUntil || '').replace(' ', 'T')}
                        onChange={(e) => setPromo({ ...promo, discountUntil: e.target.value || null })}
                      />
                    </div>
                    <button className="btn-primary" onClick={handleSavePromo} disabled={promoSaving}>
                      {promoSaving ? 'Saving…' : 'Save Promotion'}
                    </button>
                  </div>
                  <div className="mt-4">
                    <label className="flex items-center gap-2 text-sm font-medium mb-1">
                      <input
                        type="checkbox"
                        className="w-4 h-4"
                        checked={promo.showBanner !== false}
                        onChange={(e) => setPromo({ ...promo, showBanner: e.target.checked })}
                      />
                      Show a red banner across the top of the POS while it runs
                    </label>
                    <input
                      type="text"
                      className="input w-full"
                      maxLength={300}
                      value={promo.bannerText || ''}
                      onChange={(e) => setPromo({ ...promo, bannerText: e.target.value })}
                      disabled={promo.showBanner === false}
                    />
                    <p className="text-xs text-gray-500 mt-1">
                      {'{percent}'} is replaced with the discount. The last day is added
                      automatically if one is set.
                    </p>
                  </div>
                  {promoMsg && (
                    <p className={`text-sm mt-3 ${promoMsg.ok ? 'text-green-500' : 'text-red-400'}`}>
                      {promoMsg.text}
                    </p>
                  )}
                  {promoSummary && (
                    <p className="text-sm text-gray-400 mt-3">
                      Right now: <span className="font-semibold text-pos-text">{promoSummary.eligible + (promoSummary.limitedByMargin || 0)}</span>{' '}
                      products get it
                      {promoSummary.limitedByMargin ? ` (${promoSummary.limitedByMargin} limited by the minimum margin)` : ''}.
                      Excluded: {promoSummary.excludedSale} on sale / clearance, {promoSummary.excludedBrand} by
                      name, {promoSummary.excludedMargin} already at the minimum margin.
                    </p>
                  )}
                </div>
              )}

              {/* Minimum margin over cost — applies to every sale. */}
              <div className="card p-6">
                <h2 className="text-lg font-semibold mb-1">Minimum Margin</h2>
                <p className="text-sm text-gray-400 mb-4">
                  The lowest price an item can sell for is its cost plus this
                  percentage. Sales staff are blocked below it; managers and
                  admins see a warning. A trade price set on a product is
                  treated as approved, even if it sits under this minimum.
                </p>
                <div className="flex items-end gap-3 flex-wrap">
                  <div>
                    <label className="block text-sm font-medium mb-1">Cost +</label>
                    <div className="relative">
                      <input
                        type="number"
                        min={0}
                        max={500}
                        step="0.5"
                        className="input w-32 pr-8"
                        value={minMarginInput}
                        onChange={(e) => setMinMarginInput(e.target.value)}
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">%</span>
                    </div>
                  </div>
                  <button
                    className="btn-primary"
                    onClick={handleSaveMinMargin}
                    disabled={minMarginSaving}
                  >
                    {minMarginSaving ? 'Saving…' : 'Save Minimum Margin'}
                  </button>
                  {minMarginMsg && (
                    <span className={`text-sm ${minMarginMsg.ok ? 'text-green-400' : 'text-red-400'}`}>
                      {minMarginMsg.text}
                    </span>
                  )}
                </div>
              </div>

              <div className="card p-6">
                <h2 className="text-lg font-semibold mb-1">
                  Trade Auto-Discount Rules
                </h2>
                <p className="text-sm text-gray-400 mb-4">
                  What a trade customer automatically comes off. Rules are
                  checked top to bottom and the FIRST match applies — they
                  don't stack. A cashier's manual discount only wins if it's
                  larger. These mirror the Magento cart price rules.
                </p>

                <div
                  className={`rounded-lg border p-3 mb-4 flex items-center gap-3 flex-wrap ${
                    tradePausedUntil ? 'border-amber-500/60 bg-amber-500/10' : 'border-gray-600'
                  }`}
                >
                  <label className="text-sm font-medium">All rules off up to and including</label>
                  <input
                    type="date"
                    className="input w-44"
                    value={tradePausedUntil}
                    onChange={(e) => setTradePausedUntil(e.target.value)}
                  />
                  {tradePausedUntil && (
                    <button className="btn-secondary text-xs py-1" onClick={() => setTradePausedUntil('')}>
                      Clear
                    </button>
                  )}
                  <span className="text-xs text-gray-400">
                    {tradePausedUntil
                      ? 'Trade customers get no trade % until then (a trade price set on a product still applies). They come back on by themselves the day after. Save below to change it.'
                      : 'Not paused.'}
                  </span>
                </div>

                <div className="space-y-4">
                  {tradeRules.map((r) => (
                    <div
                      key={r.id}
                      className={`border rounded-lg p-4 ${
                        r.enabled
                          ? 'bg-pos-accent/40 border-gray-700'
                          : 'bg-pos-accent/10 border-gray-800 opacity-60'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3 mb-3">
                        <div className="flex-1">
                          <label className="block text-xs text-gray-400 mb-1">
                            Rule name
                          </label>
                          <input
                            type="text"
                            className="input w-full"
                            value={r.label}
                            onChange={(e) =>
                              updateTradeRule(r.id, 'label', e.target.value)
                            }
                          />
                        </div>
                        <label className="flex items-center gap-2 text-sm mt-6 whitespace-nowrap">
                          <input
                            type="checkbox"
                            className="w-4 h-4"
                            checked={r.enabled}
                            onChange={(e) =>
                              updateTradeRule(r.id, 'enabled', e.target.checked)
                            }
                          />
                          Active
                        </label>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        <div>
                          <label className="block text-xs text-gray-400 mb-1">
                            Discount %
                          </label>
                          <input
                            type="number"
                            step="0.5"
                            min="0"
                            max="100"
                            className="input w-full"
                            value={r.percent}
                            onChange={(e) =>
                              updateTradeRule(r.id, 'percent', e.target.value)
                            }
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-gray-400 mb-1">
                            Applies to
                          </label>
                          <select
                            className="input w-full"
                            value={r.matchType}
                            onChange={(e) =>
                              updateTradeRule(r.id, 'matchType', e.target.value)
                            }
                          >
                            <option value="category">A category (by ID)</option>
                            <option value="category_name">
                              A category (by name)
                            </option>
                            <option value="all_except_prefix">
                              Everything except a brand
                            </option>
                            <option value="all">Everything</option>
                          </select>
                        </div>
                        <div>
                          {r.matchType === 'category' && (
                            <>
                              <label className="block text-xs text-gray-400 mb-1">
                                Category ID
                              </label>
                              <input
                                type="number"
                                className="input w-full"
                                value={r.categoryId ?? ''}
                                onChange={(e) =>
                                  updateTradeRule(
                                    r.id,
                                    'categoryId',
                                    e.target.value,
                                  )
                                }
                              />
                              <p className="text-[11px] text-gray-500 mt-1">
                                Includes all sub-categories
                              </p>
                            </>
                          )}
                          {r.matchType === 'category_name' && (
                            <>
                              <label className="block text-xs text-gray-400 mb-1">
                                Category name
                              </label>
                              <input
                                type="text"
                                className="input w-full"
                                placeholder="e.g. Ceiling Fans"
                                value={r.categoryName ?? ''}
                                onChange={(e) =>
                                  updateTradeRule(
                                    r.id,
                                    'categoryName',
                                    e.target.value,
                                  )
                                }
                              />
                              <p className="text-[11px] text-gray-500 mt-1">
                                Includes all sub-categories
                              </p>
                            </>
                          )}
                          {r.matchType === 'all_except_prefix' && (
                            <>
                              <label className="block text-xs text-gray-400 mb-1">
                                Exclude names starting with
                              </label>
                              <input
                                type="text"
                                className="input w-full"
                                placeholder="e.g. eglo"
                                value={r.excludeNamePrefix ?? ''}
                                onChange={(e) =>
                                  updateTradeRule(
                                    r.id,
                                    'excludeNamePrefix',
                                    e.target.value,
                                  )
                                }
                              />
                            </>
                          )}
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-x-6 gap-y-2 mt-3">
                        {(r.matchType === 'category' ||
                          r.matchType === 'category_name') && (
                          <label className="flex items-center gap-2 text-xs text-gray-300">
                            <input
                              type="checkbox"
                              className="w-4 h-4"
                              checked={!!r.excludeNamePrefix}
                              onChange={(e) =>
                                updateTradeRule(
                                  r.id,
                                  'excludeNamePrefix',
                                  e.target.checked ? 'eglo' : '',
                                )
                              }
                            />
                            Exclude Eglo
                          </label>
                        )}
                        <label className="flex items-center gap-2 text-xs text-gray-300">
                          <input
                            type="checkbox"
                            className="w-4 h-4"
                            checked={!!r.baseOnSpecialPrice}
                            onChange={(e) =>
                              updateTradeRule(
                                r.id,
                                'baseOnSpecialPrice',
                                e.target.checked,
                              )
                            }
                          />
                          Apply % to special price (not RRP)
                        </label>
                        <label className="flex items-center gap-2 text-xs text-gray-300">
                          <input
                            type="checkbox"
                            className="w-4 h-4"
                            checked={!!r.excludeClearance}
                            onChange={(e) =>
                              updateTradeRule(
                                r.id,
                                'excludeClearance',
                                e.target.checked,
                              )
                            }
                          />
                          No discount on SALE / CLEARANCE items
                        </label>
                      </div>
                    </div>
                  ))}
                </div>

                <p className="text-xs text-gray-500 mt-4">
                  Note: trade prices off the fixed retail price, never on top
                  of a sale price — except where the sale price is already
                  cheaper than the trade price, in which case the customer
                  price wins.
                </p>

                <div className="flex gap-3 mt-4">
                  <button
                    className="btn-primary"
                    onClick={handleSaveTradeRules}
                    disabled={isSaving}
                  >
                    {isSaving ? 'Saving...' : 'Save Trade Pricing Rules'}
                  </button>
                  <button
                    className="btn-secondary"
                    disabled={isSaving || tradeRuleDefaults.length === 0}
                    onClick={() => {
                      setTradeRules(tradeRuleDefaults);
                      setSaveMessage('Defaults loaded — press Save to apply them.');
                      setTimeout(() => setSaveMessage(''), 4000);
                    }}
                  >
                    Load Defaults
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* LED Strip cut-to-length rates */}
          {activeTab === 'ledstrip' && (
            <div className="space-y-6">
              <div className="card p-6">
                <h2 className="text-lg font-semibold mb-1">
                  LED Strip — Cut-to-Length Rates
                </h2>
                <p className="text-sm text-gray-400 mb-4">
                  Drives the Strip Cut Counter on the POS screen. All prices
                  are per metre and GST inclusive.
                </p>

                <div className="space-y-4">
                  {stripProducts.map((p) => (
                    <div
                      key={p.id}
                      className="bg-pos-accent/40 border border-gray-700 rounded-lg p-4"
                    >
                      <div className="mb-3">
                        <label className="block text-xs text-gray-400 mb-1">
                          Product name
                        </label>
                        <input
                          type="text"
                          className="input w-full"
                          value={p.name}
                          onChange={(e) =>
                            updateStripField(p.id, 'name', e.target.value)
                          }
                        />
                        <p className="text-[11px] text-gray-500 mt-1 font-mono">
                          {p.id}
                        </p>
                      </div>

                      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                        <div>
                          <label className="block text-xs text-gray-400 mb-1">
                            Retail $/m
                          </label>
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            className="input w-full"
                            value={p.retailPerM}
                            onChange={(e) =>
                              updateStripField(p.id, 'retailPerM', e.target.value)
                            }
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-gray-400 mb-1">
                            Trade $/m
                          </label>
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            className="input w-full"
                            value={p.tradePerM}
                            onChange={(e) =>
                              updateStripField(p.id, 'tradePerM', e.target.value)
                            }
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-gray-400 mb-1">
                            Tail $/m
                          </label>
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            className="input w-full"
                            value={p.tailPerM}
                            onChange={(e) =>
                              updateStripField(p.id, 'tailPerM', e.target.value)
                            }
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-gray-400 mb-1">
                            Tail incl. (m)
                          </label>
                          <input
                            type="number"
                            step="0.5"
                            min="0"
                            className="input w-full"
                            value={p.includedTailM}
                            onChange={(e) =>
                              updateStripField(p.id, 'includedTailM', e.target.value)
                            }
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-gray-400 mb-1">
                            Cut every (mm)
                          </label>
                          <input
                            type="number"
                            step="50"
                            min="1"
                            className="input w-full"
                            value={p.cutMm}
                            onChange={(e) =>
                              updateStripField(p.id, 'cutMm', e.target.value)
                            }
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-gray-400 mb-1">
                            Max run (m)
                          </label>
                          <input
                            type="number"
                            step="1"
                            min="1"
                            className="input w-full"
                            value={p.maxRunM}
                            onChange={(e) =>
                              updateStripField(p.id, 'maxRunM', e.target.value)
                            }
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                <p className="text-xs text-gray-500 mt-4">
                  Max run is advisory only — staff are warned but can still
                  sell longer lengths (they just need joiners).
                </p>

                <div className="flex gap-3 mt-4">
                  <button
                    className="btn-primary"
                    onClick={handleSaveStripProducts}
                    disabled={isSaving}
                  >
                    {isSaving ? 'Saving...' : 'Save LED Strip Pricing'}
                  </button>
                  <button
                    className="btn-secondary"
                    onClick={handleResetStripProducts}
                    disabled={isSaving}
                  >
                    Load Defaults
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Magento Sync */}
          {activeTab === 'sync' && (
            <div className="space-y-6">
              {/* Sync Status */}
              <div className="card p-6">
                <h2 className="text-lg font-semibold mb-4">Sync Status</h2>
                {syncStatus ? (
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="bg-pos-accent rounded-lg p-4 text-center">
                      <div className="text-2xl font-bold text-primary-400">{syncStatus.categoryCount}</div>
                      <div className="text-sm text-gray-400">Categories</div>
                    </div>
                    <div className="bg-pos-accent rounded-lg p-4 text-center">
                      <div className="text-2xl font-bold text-primary-400">{syncStatus.productCount}</div>
                      <div className="text-sm text-gray-400">Products</div>
                    </div>
                    <div className="bg-pos-accent rounded-lg p-4 text-center">
                      <div className="text-2xl font-bold text-primary-400">{syncStatus.customerCount}</div>
                      <div className="text-sm text-gray-400">Customers</div>
                    </div>
                    <div className="bg-pos-accent rounded-lg p-4 text-center">
                      <div className="text-sm font-medium text-gray-300">
                        {syncStatus.lastSync
                          ? new Date(syncStatus.lastSync).toLocaleString()
                          : 'Never'}
                      </div>
                      <div className="text-sm text-gray-400">
                        Last Sync
                        {syncStatus.lastSyncType ? ` (${syncStatus.lastSyncType})` : ''}
                      </div>
                      {/* A run that finished with some record errors still
                          counts as the last sync; say so, and show when the
                          last clean one was. */}
                      {syncStatus.lastSyncStatus === 'partial' && (
                        <div className="text-xs text-amber-300 mt-1">
                          {syncStatus.lastSyncFailed} record{syncStatus.lastSyncFailed === 1 ? '' : 's'} failed
                          {syncStatus.lastSuccessfulSync &&
                            ` · last clean run ${new Date(syncStatus.lastSuccessfulSync).toLocaleDateString()}`}
                        </div>
                      )}
                      {syncStatus.lastSyncStatus === 'failed' && (
                        <div className="text-xs text-red-400 mt-1">
                          Run failed
                          {syncStatus.lastSuccessfulSync &&
                            ` · last clean run ${new Date(syncStatus.lastSuccessfulSync).toLocaleDateString()}`}
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="text-gray-400">Loading status...</div>
                )}
              </div>

              {/* Live progress of the running (or last) sync */}
              {liveProgress && (
                <div className="card p-6">
                  {!liveProgress.finishedAt ? (
                    (() => {
                      const pct =
                        liveProgress.total > 0
                          ? Math.min(100, Math.round((liveProgress.current / liveProgress.total) * 100))
                          : null;
                      const elapsedS = Math.max(
                        1,
                        Math.round((Date.now() - new Date(liveProgress.startedAt).getTime()) / 1000),
                      );
                      const rate = liveProgress.current / elapsedS;
                      const etaS =
                        pct !== null && liveProgress.current > 20 && rate > 0
                          ? Math.round((liveProgress.total - liveProgress.current) / rate)
                          : null;
                      const fmt = (s: number) =>
                        s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`;
                      return (
                        <>
                          <div className="flex items-center justify-between mb-2">
                            <div className="font-semibold flex items-center gap-2">
                              <ArrowPathIcon className="h-5 w-5 animate-spin text-primary-400" />
                              {liveProgress.phase}
                            </div>
                            <div className="text-sm text-gray-400">
                              {pct !== null
                                ? `${liveProgress.current.toLocaleString()} / ${liveProgress.total.toLocaleString()} (${pct}%)`
                                : `running ${fmt(elapsedS)}…`}
                              {etaS !== null && ` · ~${fmt(etaS)} left`}
                            </div>
                          </div>
                          <div className="h-3 bg-pos-accent rounded-full overflow-hidden">
                            {pct !== null ? (
                              <div
                                className="h-full bg-primary-500 rounded-full transition-all duration-500"
                                style={{ width: `${pct}%` }}
                              />
                            ) : (
                              <div className="h-full w-1/3 bg-primary-500/70 rounded-full animate-pulse" />
                            )}
                          </div>
                        </>
                      );
                    })()
                  ) : (
                    <div>
                      <div
                        className={`text-sm ${liveProgress.success ? 'text-green-400' : 'text-red-400'}`}
                      >
                        {liveProgress.success ? '✓' : '✗'} {liveProgress.message} —{' '}
                        {new Date(liveProgress.finishedAt).toLocaleString('en-AU', {
                          day: 'numeric',
                          month: 'short',
                          hour: 'numeric',
                          minute: '2-digit',
                        })}
                        {(liveProgress.errors?.length ?? 0) > 0 && (
                          <button
                            className="ml-3 text-xs underline text-gray-400 hover:text-gray-200"
                            onClick={() => setShowSyncErrors((v) => !v)}
                          >
                            {showSyncErrors ? 'Hide errors' : `Show ${liveProgress.errors!.length} error${liveProgress.errors!.length === 1 ? '' : 's'}`}
                          </button>
                        )}
                      </div>
                      {showSyncErrors && (liveProgress.errors?.length ?? 0) > 0 && (
                        <ul className="mt-2 max-h-64 overflow-y-auto text-xs font-mono text-red-300 space-y-1 bg-pos-dark rounded p-3">
                          {liveProgress.errors!.map((e, i) => (
                            <li key={i} className="break-all">{e}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Sync Result */}
              {syncResult && (
                <div
                  className={`px-4 py-3 rounded ${
                    syncResult.success
                      ? 'bg-green-600/20 text-green-400 border border-green-600'
                      : 'bg-red-600/20 text-red-400 border border-red-600'
                  }`}
                >
                  {syncResult.message}
                </div>
              )}

              <WebsiteOrdersCard />

              {/* Automatic product sync schedule (Sally, 10 Sep 2026) */}
              <div className="card p-6">
                <h2 className="text-lg font-semibold mb-1">Automatic Product Sync</h2>
                <p className="text-sm text-gray-400 mb-4">
                  Pulls prices, specials, stock and new products from Magento on a
                  schedule so nobody has to press "Sync Products Only". Cost prices
                  are never touched by a sync.
                </p>
                {autoSync === null ? (
                  <div className="text-gray-400 text-sm">
                    Schedule unavailable — backend needs updating.
                  </div>
                ) : (
                  <>
                    <div className="flex flex-col md:flex-row md:items-end gap-4">
                      <div>
                        <label className="block text-sm font-medium mb-1">Schedule</label>
                        <select
                          className="input w-full md:w-64"
                          value={
                            autoSyncDraft.mode === 'interval'
                              ? `interval:${autoSyncDraft.intervalMinutes}`
                              : autoSyncDraft.mode
                          }
                          onChange={(e) => {
                            const v = e.target.value;
                            if (v === 'off') {
                              setAutoSyncDraft({ ...autoSyncDraft, mode: 'off' });
                            } else if (v === 'daily') {
                              setAutoSyncDraft({ ...autoSyncDraft, mode: 'daily' });
                            } else {
                              setAutoSyncDraft({
                                ...autoSyncDraft,
                                mode: 'interval',
                                intervalMinutes: parseInt(v.split(':')[1], 10),
                              });
                            }
                          }}
                        >
                          <option value="off">Off — manual only</option>
                          <option value="interval:15">Every 15 minutes</option>
                          <option value="interval:30">Every 30 minutes</option>
                          <option value="interval:60">Every hour</option>
                          <option value="interval:120">Every 2 hours</option>
                          <option value="daily">Once a day at a set time</option>
                        </select>
                      </div>
                      {autoSyncDraft.mode === 'daily' && (
                        <div>
                          <label className="block text-sm font-medium mb-1">
                            Time (Melbourne)
                          </label>
                          <input
                            type="time"
                            className="input w-40"
                            value={autoSyncDraft.dailyTime}
                            onChange={(e) =>
                              setAutoSyncDraft({ ...autoSyncDraft, dailyTime: e.target.value })
                            }
                          />
                        </div>
                      )}
                      <button
                        className="btn-primary"
                        onClick={handleSaveAutoSync}
                        disabled={autoSyncSaving}
                      >
                        {autoSyncSaving ? 'Saving…' : 'Save Schedule'}
                      </button>
                    </div>

                    <div className="mt-4 text-sm text-gray-400 space-y-1">
                      {autoSync.config.mode === 'off' ? (
                        <div>Automatic sync is off.</div>
                      ) : (
                        <div>
                          Next automatic sync:{' '}
                          <span className="text-gray-200">
                            {autoSync.nextRunLabel
                              ? /^\d{4}-/.test(autoSync.nextRunLabel)
                                ? new Date(autoSync.nextRunLabel).toLocaleString()
                                : autoSync.nextRunLabel
                              : '—'}
                          </span>
                          {autoSync.busy && ' (a sync is running now)'}
                        </div>
                      )}
                      <div>
                        Last product sync (any):{' '}
                        <span className="text-gray-200">
                          {autoSync.lastProductSyncAt
                            ? new Date(autoSync.lastProductSyncAt).toLocaleString()
                            : 'none since the server last restarted'}
                        </span>
                      </div>
                      {autoSync.lastAutoRunAt && (
                        <div>
                          Last automatic run:{' '}
                          <span className="text-gray-200">
                            {new Date(autoSync.lastAutoRunAt).toLocaleString()}
                          </span>
                          {autoSync.lastAutoResult && (
                            <span
                              className={
                                autoSync.lastAutoResult.success
                                  ? 'text-green-400'
                                  : 'text-red-400'
                              }
                            >
                              {' '}
                              — {autoSync.lastAutoResult.message}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>

              {/* Sync Actions */}
              <div className="card p-6">
                <h2 className="text-lg font-semibold mb-4">Sync Actions</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <button
                    className="flex items-center justify-center gap-2 bg-primary-600 hover:bg-primary-700 text-white px-4 py-3 rounded-lg disabled:opacity-50"
                    onClick={() => handleSync('full')}
                    disabled={syncRunning !== null}
                  >
                    <ArrowPathIcon className={`h-5 w-5 ${syncRunning === 'full' ? 'animate-spin' : ''}`} />
                    {syncRunning === 'full' ? 'Running Full Sync...' : 'Full Sync (Categories + Products + Customers)'}
                  </button>

                  <button
                    className="flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-3 rounded-lg disabled:opacity-50"
                    onClick={() => handleSync('customers')}
                    disabled={syncRunning !== null}
                  >
                    <ArrowPathIcon className={`h-5 w-5 ${syncRunning === 'customers' ? 'animate-spin' : ''}`} />
                    {syncRunning === 'customers' ? 'Syncing Customers...' : 'Sync Customers Only'}
                  </button>

                  <button
                    className="flex items-center justify-center gap-2 bg-purple-600 hover:bg-purple-700 text-white px-4 py-3 rounded-lg disabled:opacity-50"
                    onClick={() => handleSync('orders')}
                    disabled={syncRunning !== null}
                  >
                    <ArrowPathIcon className={`h-5 w-5 ${syncRunning === 'orders' ? 'animate-spin' : ''}`} />
                    {syncRunning === 'orders' ? 'Syncing Orders...' : 'Sync Orders from Magento'}
                  </button>

                  <button
                    className="flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700 text-white px-4 py-3 rounded-lg disabled:opacity-50"
                    onClick={() => handleSync('push-orders')}
                    disabled={syncRunning !== null}
                  >
                    <ArrowPathIcon className={`h-5 w-5 ${syncRunning === 'push-orders' ? 'animate-spin' : ''}`} />
                    {syncRunning === 'push-orders' ? 'Pushing to Magento...' : 'Push Pending POS Orders to Magento'}
                  </button>

                  <button
                    className="flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-3 rounded-lg disabled:opacity-50"
                    onClick={() => handleSync('products')}
                    disabled={syncRunning !== null}
                  >
                    <ArrowPathIcon className={`h-5 w-5 ${syncRunning === 'products' ? 'animate-spin' : ''}`} />
                    {syncRunning === 'products' ? 'Syncing Products...' : 'Sync Products Only'}
                  </button>

                  <button
                    className="flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-3 rounded-lg disabled:opacity-50"
                    onClick={() => handleSync('categories')}
                    disabled={syncRunning !== null}
                  >
                    <ArrowPathIcon className={`h-5 w-5 ${syncRunning === 'categories' ? 'animate-spin' : ''}`} />
                    {syncRunning === 'categories' ? 'Syncing Categories...' : 'Sync Categories Only'}
                  </button>

                  <button
                    className="flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700 text-white px-4 py-3 rounded-lg disabled:opacity-50"
                    onClick={() => handleSync('stock')}
                    disabled={syncRunning !== null}
                  >
                    <ArrowPathIcon className={`h-5 w-5 ${syncRunning === 'stock' ? 'animate-spin' : ''}`} />
                    {syncRunning === 'stock' ? 'Syncing Stock...' : 'Sync Stock Only (Fast)'}
                  </button>

                  <button
                    className="flex items-center justify-center gap-2 bg-red-600 hover:bg-red-700 text-white px-4 py-3 rounded-lg disabled:opacity-50"
                    onClick={() => {
                      if (window.confirm('This will DELETE all products and categories then re-sync from Magento. Are you sure?')) {
                        handleSync('clear-and-sync');
                      }
                    }}
                    disabled={syncRunning !== null}
                  >
                    <ArrowPathIcon className={`h-5 w-5 ${syncRunning === 'clear-and-sync' ? 'animate-spin' : ''}`} />
                    {syncRunning === 'clear-and-sync' ? 'Clearing & Syncing...' : 'Clear All & Re-Sync (Destructive)'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* System Settings */}
          {activeTab === 'system' && (
            <div className="space-y-6">
              <div className="card p-6">
                <h2 className="text-lg font-semibold mb-4">Receipt Settings</h2>
                <div className="space-y-4">
                  <label className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      checked={systemSettings.receipt_print_enabled}
                      onChange={(e) =>
                        setSystemSettings({
                          ...systemSettings,
                          receipt_print_enabled: e.target.checked,
                        })
                      }
                      className="rounded bg-pos-dark border-gray-600 h-5 w-5"
                    />
                    <span>Enable Receipt Printing</span>
                  </label>
                  <div>
                    <label className="block text-sm text-gray-400 mb-1">Receipt Logo URL</label>
                    <input
                      type="text"
                      className="input"
                      value={systemSettings.receipt_logo_url}
                      onChange={(e) =>
                        setSystemSettings({
                          ...systemSettings,
                          receipt_logo_url: e.target.value,
                        })
                      }
                      placeholder="https://..."
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-400 mb-1">Receipt Footer Text</label>
                    <input
                      type="text"
                      className="input"
                      value={systemSettings.receipt_footer_text}
                      onChange={(e) =>
                        setSystemSettings({
                          ...systemSettings,
                          receipt_footer_text: e.target.value,
                        })
                      }
                    />
                  </div>
                </div>
              </div>

              <div className="card p-6">
                <h2 className="text-lg font-semibold mb-4">Checkout Defaults</h2>
                <div className="space-y-4">
                  <label className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      checked={systemSettings.default_stock_hold}
                      onChange={(e) =>
                        setSystemSettings({
                          ...systemSettings,
                          default_stock_hold: e.target.checked,
                        })
                      }
                      className="rounded bg-pos-dark border-gray-600 h-5 w-5"
                    />
                    <div>
                      <span>Hold Stock by Default</span>
                      <p className="text-sm text-gray-400">
                        When creating quotes, hold stock automatically
                      </p>
                    </div>
                  </label>
                </div>
              </div>

              <div className="card p-6">
                <h2 className="text-lg font-semibold mb-4">Offline Mode</h2>
                <div className="space-y-4">
                  <label className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      checked={systemSettings.offline_mode_enabled}
                      onChange={(e) =>
                        setSystemSettings({
                          ...systemSettings,
                          offline_mode_enabled: e.target.checked,
                        })
                      }
                      className="rounded bg-pos-dark border-gray-600 h-5 w-5"
                    />
                    <div>
                      <span>Enable Offline Mode</span>
                      <p className="text-sm text-gray-400">
                        Allow sales to be captured when offline and sync later
                      </p>
                    </div>
                  </label>
                </div>
              </div>

              <div className="flex justify-end">
                <button
                  onClick={handleSaveSystem}
                  disabled={isSaving}
                  className="btn-primary px-6"
                >
                  {isSaving ? 'Saving...' : 'Save System Settings'}
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* Edit Role Modal */}
      {editingRole && (
        <div className="modal-backdrop">
          <div className="modal-content">
            <div className="flex items-center justify-between mb-4">
              <button onClick={() => setEditingRole(null)} className="modal-back-btn">
                <ArrowLeftIcon className="h-5 w-5" /> Back
              </button>
              <h2 className="text-xl font-bold">Edit Role: {editingRole.name}</h2>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm text-gray-400 mb-1">Display Name</label>
                <input
                  type="text"
                  className="input"
                  value={editingRole.displayName}
                  onChange={(e) =>
                    setEditingRole({ ...editingRole, displayName: e.target.value })
                  }
                />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Max Discount (%)</label>
                <input
                  type="number"
                  className="input"
                  value={editingRole.maxDiscountPercent}
                  onChange={(e) =>
                    setEditingRole({
                      ...editingRole,
                      maxDiscountPercent: parseFloat(e.target.value),
                    })
                  }
                  min="0"
                  max="100"
                  step="1"
                />
              </div>
              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={editingRole.canStackDiscounts}
                  onChange={(e) =>
                    setEditingRole({
                      ...editingRole,
                      canStackDiscounts: e.target.checked,
                    })
                  }
                  className="rounded bg-pos-dark border-gray-600 h-5 w-5"
                />
                <span>Can Stack Discounts</span>
              </label>
            </div>

            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => setEditingRole(null)}
                className="px-4 py-2 text-gray-400 hover:text-pos-text"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveRole}
                disabled={isSaving}
                className="btn-primary"
              >
                {isSaving ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
