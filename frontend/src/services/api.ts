import axios from 'axios';

const API_BASE_URL = '/api/v1';

// Create axios instance
const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor to add auth token
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('pos_token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response interceptor for error handling
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      // Token expired or invalid
      localStorage.removeItem('pos_token');
      localStorage.removeItem('pos_user');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

// Auth API
export const authApi = {
  login: (credentials: { email: string; password: string }) =>
    api.post('/auth/login', credentials),

  pinLogin: (pinCode: string) => api.post('/auth/pin-login', { pinCode }),

  logout: () => api.post('/auth/logout'),

  getMe: () => api.get('/auth/me'),
};

// Products API
export const productsApi = {
  getProducts: (params?: {
    search?: string;
    category?: number;
    inStock?: boolean;
    page?: number;
    limit?: number;
  }) => api.get('/products', { params }),

  getProduct: (id: number) => api.get(`/products/${id}`),

  getByBarcode: (barcode: string) => api.get(`/products/barcode/${barcode}`),

  getProductDetail: (id: number) => api.get(`/products/${id}/detail`),

  getBySku: (sku: string) => api.get(`/products/sku/${sku}`),

  getCategories: () => api.get('/products/categories'),

  getSubcategories: (categoryId: number) =>
    api.get(`/products/categories/${categoryId}/subcategories`),

  // Trade auto-discount rules (manager/admin read, admin write).
  getTradeRules: () => api.get('/products/trade-rules'),
  // pausedUntil: last day (YYYY-MM-DD) every trade % rule is off; '' = not paused.
  updateTradeRules: (rules: any[], pausedUntil?: string) =>
    api.put('/products/trade-rules', pausedUntil === undefined ? { rules } : { rules, pausedUntil }),

  // On-the-spot supplier cost correction (manager/admin). null clears it.
  updateCost: (id: number, cost: number | null) =>
    api.patch(`/products/${id}/cost`, { cost }),

  // Per-product trade price (manager/admin). null returns the product to
  // the trade rules. confirmBelowFloor: admin accepting a price under
  // the minimum margin.
  updateTradePrice: (
    id: number,
    tradePrice: number | null,
    confirmBelowFloor = false,
  ) => api.patch(`/products/${id}/trade-price`, { tradePrice, confirmBelowFloor }),

  // Below cost + minimum margin? (yes/no; managers also get minPrice)
  marginCheck: (items: Array<{ productId: number; price: number; trade?: boolean }>) =>
    api.post('/products/margin-check', { items }),

  // Checkout promotion (fans 10%, Oct 2026): manager/admin read, admin write.
  getPromotion: () => api.get('/products/promotion'),
  // Running promotion for the red banner on the POS (any staff).
  getActivePromotion: () => api.get('/products/promotion/active'),
  updatePromotion: (promotion: Record<string, unknown>) =>
    api.put('/products/promotion', promotion),

  // Minimum margin over cost (any staff reads; admin writes).
  getPricingConfig: () => api.get('/products/pricing-config'),
  updatePricingConfig: (minMarginPercent: number) =>
    api.put('/products/pricing-config', { minMarginPercent }),
};

// Customers API
export const customersApi = {
  getCustomers: (params?: { search?: string; page?: number; limit?: number }) =>
    api.get('/customers', { params }),

  getCustomer: (id: number) => api.get(`/customers/${id}`),

  createCustomer: (data: any) => api.post('/customers', data),

  getCustomerStats: (id: number) => api.get(`/customers/${id}/stats`),

  getStoreCredit: (id: number) => api.get(`/customers/${id}/store-credit`),

  adjustStoreCredit: (id: number, data: { amount: number; note: string }) =>
    api.post(`/customers/${id}/store-credit/adjust`, data),

  // Hand leftover credit back as cash — used when an exchange is
  // cheaper than the returned item and the difference must be paid out.
  cashOutStoreCredit: (id: number, data: { amount: number; note?: string }) =>
    api.post(`/customers/${id}/store-credit/cash-out`, data),

  updateCustomer: (id: number, data: any) => api.put(`/customers/${id}`, data),
  // Quick trade toggle (any staff).
  setCustomerTrade: (id: number, isTrade: boolean) =>
    api.patch(`/customers/${id}/trade`, { isTrade }),

  mergeDuplicates: () => api.post('/customers/merge-duplicates'),
};

// Orders API
export const ordersApi = {
  getOrders: (params?: {
    status?: string;
    source?: string;
    type?: string;
    search?: string;
    userId?: number;
    customerId?: number;
    dateFrom?: string;
    dateTo?: string;
    page?: number;
    limit?: number;
  }) => api.get('/orders', { params }),

  getOrder: (id: number) => api.get(`/orders/${id}`),
  // Original Excel invoice for orders imported from the old system.
  getOriginalInvoice: (id: number) =>
    api.get(`/orders/${id}/original-invoice`, { responseType: 'blob' }),
  // Per-line status from the order screen (backorder / layby / paid).
  setItemStatus: (id: number, itemId: number, status: 'backorder' | 'layby' | 'paid') =>
    api.patch(`/orders/${id}/items/${itemId}/status`, { status }),
  // Void a sale put through by mistake (admin) — out of the reports.
  voidOrder: (id: number, reason: string) => api.post(`/orders/${id}/void`, { reason }),
  // Customer takes some of the back-order / lay-by items now.
  collectItems: (id: number, lines: Array<{ itemId: number; qty: number }>) =>
    api.post(`/orders/${id}/collect`, { lines }),
  // Website orders: Back Order (some or all of a line) / Complete.
  setWebsiteLineStatus: (id: number, itemId: number, status: 'backorder' | 'complete', qty?: number) =>
    api.patch(`/orders/${id}/items/${itemId}/website-status`, { status, qty }),

  createOrder: (data: any) => api.post('/orders', data),

  linkCustomer: (orderId: number, customerId: number) =>
    api.patch(`/orders/${orderId}/customer`, { customerId }),

  // Either field may be omitted to leave it untouched: `notes` is the
  // customer-facing note (prints on the invoice), `internalNotes` is
  // staff-only.
  updateNotes: (
    orderId: number,
    notes?: string | null,
    internalNotes?: string | null,
  ) =>
    api.patch(`/orders/${orderId}/notes`, {
      ...(notes !== undefined ? { notes } : {}),
      ...(internalNotes !== undefined ? { internalNotes } : {}),
    }),

  // Edit line items on an open order (backorder/layby/pending). Server
  // rewrites the whole item set + re-totals. Blocked on complete
  // orders.
  updateItems: (
    orderId: number,
    items: Array<{
      productId: number;
      quantity: number;
      discountPercent?: number;
      unitPrice?: number;
      isBackorder?: boolean;
      isLaybyHeld?: boolean;
      isCustom?: boolean;
      sku?: string;
      name?: string;
      fromItemId?: number;
    }>,
  ) => api.patch(`/orders/${orderId}/items`, { items }),

  // Correct a previously-recorded payment amount (cashier typo).
  // Doesn't refund; use refundOrder for actual money back.
  adjustPayment: (orderId: number, paymentId: number, amount: number) =>
    api.patch(`/orders/${orderId}/payments/${paymentId}`, { amount }),
  // Relabel how a payment was taken (EFTPOS -> cash etc.), amount unchanged.
  changePaymentMethod: (orderId: number, paymentId: number, method: string, reference?: string) =>
    api.patch(`/orders/${orderId}/payments/${paymentId}/method`, { method, reference }),

  createRefund: (
    orderId: number,
    data: {
      reason: string;
      reasonText?: string;
      items: Array<{ orderItemId: number; quantity: number; restock: boolean }>;
      asCash?: boolean;
      applyRestockingFee?: boolean;
    },
  ) => api.post(`/orders/${orderId}/refund`, data),

  getRefunds: (orderId: number) => api.get(`/orders/${orderId}/refunds`),

  // Layby
  takeLaybyPayment: (
    orderId: number,
    data: {
      amount: number;
      method: string;
      reference?: string;
      amountTendered?: number;
    },
  ) => api.post(`/orders/${orderId}/layby/payment`, data),

  cancelLayby: (
    orderId: number,
    data: { reason?: string; refundAsStoreCredit?: boolean },
  ) => api.post(`/orders/${orderId}/layby/cancel`, data),

  getLaybyBalance: (orderId: number) =>
    api.get(`/orders/${orderId}/layby/balance`),

  expireLaybys: () => api.post('/orders/laybys/expire'),

  // Backorder
  fulfillBackorder: (orderId: number, itemIds: number[]) =>
    api.post(`/orders/${orderId}/backorder/fulfill`, { itemIds }),
};

// Discounts API
export const discountsApi = {
  validate: (data: {
    items: Array<{
      productId: number;
      sku?: string;
      name?: string;
      quantity: number;
      unitPrice: number;
      discountPercent?: number;
    }>;
    cartDiscount?: {
      type: 'percent' | 'fixed';
      value: number;
      reason?: string;
    };
  }) => api.post('/discounts/validate', data),
};

// Quotes API
export const quotesApi = {
  getQuotes: (params?: {
    status?: string;
    customerId?: number;
    page?: number;
    limit?: number;
  }) => api.get('/quotes', { params }),

  getQuote: (id: number) => api.get(`/quotes/${id}`),

  createQuote: (data: any) => api.post('/quotes', data),

  updateQuote: (id: number, data: any) => api.patch(`/quotes/${id}`, data),

  cancelQuote: (id: number) => api.post(`/quotes/${id}/cancel`),

  convertCheck: (id: number) => api.get(`/quotes/${id}/convert-check`),

  convertToOrder: (
    id: number,
    data: {
      payments: any[];
      customerId?: number;
      notes?: string;
      allowBackorder?: boolean;
      // 'full' pays and takes the goods now; 'layby' holds them against
      // a deposit; 'backorder' orders every line from the supplier.
      fulfilment?: 'full' | 'layby' | 'backorder';
    },
  ) => api.post(`/quotes/${id}/convert`, data),

  // Returns the auto trade discount the server would apply per product
  // ID — used by the Quotes form / POS cart for live preview when the
  // buyer is trade.
  tradeDiscountPreview: (productIds: number[]) =>
    api.post('/quotes/trade-discount-preview', { productIds }),

  // Flag a quote CONVERTED and link the order that completed it — used
  // by the POS checkout when the cart was loaded from a quote.
  markConverted: (id: number, orderId: number) =>
    api.patch(`/quotes/${id}/mark-converted`, { orderId }),
};

// Users API (Admin only)
export const usersApi = {
  getUsers: (params?: {
    page?: number;
    limit?: number;
    role?: string;
    active?: boolean;
  }) => api.get('/users', { params }),

  getUser: (id: number) => api.get(`/users/${id}`),

  createUser: (data: any) => api.post('/users', data),

  updateUser: (id: number, data: any) => api.put(`/users/${id}`, data),

  deleteUser: (id: number) => api.delete(`/users/${id}`),

  getRoles: () => api.get('/users/roles'),
};

// Inquiries API
export const inquiriesApi = {
  getInquiries: (params?: {
    status?: string;
    type?: string;
    customerId?: number;
    page?: number;
    limit?: number;
  }) => api.get('/inquiries', { params }),

  getInquiry: (id: number) => api.get(`/inquiries/${id}`),

  createInquiry: (data: any) => api.post('/inquiries', data),

  updateInquiry: (id: number, data: any) => api.put(`/inquiries/${id}`, data),
};

// Suppliers API
export const suppliersApi = {
  getSuppliers: (params?: { search?: string }) =>
    api.get('/suppliers', { params }),

  getSupplier: (id: number) => api.get(`/suppliers/${id}`),

  createSupplier: (data: any) => api.post('/suppliers', data),

  updateSupplier: (id: number, data: any) => api.put(`/suppliers/${id}`, data),

  deleteSupplier: (id: number) => api.delete(`/suppliers/${id}`),
};

// Warranties API
export const warrantiesApi = {
  getWarranties: (params?: {
    status?: string;
    supplierId?: number;
    page?: number;
    limit?: number;
  }) => api.get('/warranties', { params }),

  getWarranty: (id: number) => api.get(`/warranties/${id}`),

  createWarranty: (data: any) => api.post('/warranties', data),

  updateWarranty: (id: number, data: any) => api.put(`/warranties/${id}`, data),

  deleteWarranty: (id: number) => api.delete(`/warranties/${id}`),
};

// Reports API
export const reportsApi = {
  getSalesReport: (params: { dateFrom: string; dateTo: string; groupBy?: string }) =>
    api.get('/reports/sales', { params }),

  getSalesByUser: (params: { dateFrom: string; dateTo: string }) =>
    api.get('/reports/sales-by-user', { params }),

  getDiscountReport: (params: { dateFrom: string; dateTo: string }) =>
    api.get('/reports/discounts', { params }),

  getQuotesReport: (params: { dateFrom: string; dateTo: string }) =>
    api.get('/reports/quotes', { params }),

  // ---- Oct 2026 report suite. Dates are YYYY-MM-DD store days.
  summary: (params: ReportRange & { tradeOnly?: boolean }) => api.get('/reports/summary', { params }),
  eod: () => api.get('/reports/eod'),
  closeDay: (body: { cashCounted?: number | null; notes?: string }) => api.post('/reports/eod/close', body),
  eodHistory: (limit = 60) => api.get('/reports/eod/history', { params: { limit } }),
  eodOne: (id: number) => api.get(`/reports/eod/${id}`),
  profitLoss: (params: ReportRange) => api.get('/reports/profit-loss', { params }),
  clearance: (params: ReportRange) => api.get('/reports/clearance', { params }),
  items: (params: ReportRange & { search?: string; tradeOnly?: boolean; limit?: number }) =>
    api.get('/reports/items', { params }),
  trade: (params: ReportRange) => api.get('/reports/trade', { params }),
  staff: (params: ReportRange) => api.get('/reports/staff', { params }),
  customers: (params: ReportRange & { limit?: number }) => api.get('/reports/customers', { params }),
  customerHistory: (id: number) => api.get(`/reports/customers/${id}/history`),
  backorders: () => api.get('/reports/backorders'),
  // Purchase orders for backorders (Sally, 15 Oct 2026)
  unorderBackorderLine: (lineId: number) => api.post(`/reports/backorders/lines/${lineId}/unorder`),
  nextPoNumber: (supplier: string) =>
    api.get('/reports/backorders/next-po-number', { params: { supplier } }),
  markPurchaseOrder: (data: { supplier: string; lineIds: number[]; poNumber?: string }) =>
    api.post('/reports/backorders/purchase-orders', data),
  // Supplier / brand names (custom items, moving a backorder line).
  supplierNames: () => api.get('/reports/suppliers'),
  setBackorderSupplier: (lineId: number, supplier: string) =>
    api.post(`/reports/backorders/lines/${lineId}/supplier`, { supplier }),
};

export interface ReportRange {
  from: string;
  to: string;
  channel?: 'store' | 'pos' | 'web' | 'all';
  groupBy?: 'day' | 'week' | 'month' | 'year';
}

// Settings API (Admin only)
export const settingsApi = {
  // Store settings
  getStoreSettings: () => api.get('/settings/store'),

  updateStoreSettings: (data: {
    store_name?: string;
    store_abn?: string;
    store_address?: string;
    store_phone?: string;
    store_email?: string;
    tax_rate?: number;
    quote_expiry_days?: number;
    trading_hours?: any;
  }) => api.put('/settings/store', data),

  // Payment settings
  getPaymentSettings: () => api.get('/settings/payments'),

  updatePaymentSettings: (data: {
    payment_cash_enabled?: boolean;
    payment_eftpos_enabled?: boolean;
    payment_credit_card_enabled?: boolean;
    payment_store_credit_enabled?: boolean;
    default_payment_method?: string;
  }) => api.put('/settings/payments', data),

  // Role settings
  getRoles: () => api.get('/settings/roles'),

  updateRole: (
    id: number,
    data: {
      displayName?: string;
      maxDiscountPercent?: number;
      canStackDiscounts?: boolean;
    }
  ) => api.put(`/settings/roles/${id}`, data),

  // System settings
  getSystemSettings: () => api.get('/settings/system'),

  updateSystemSettings: (data: {
    receipt_print_enabled?: boolean;
    receipt_logo_url?: string;
    receipt_footer_text?: string;
    default_stock_hold?: boolean;
    offline_mode_enabled?: boolean;
  }) => api.put('/settings/system', data),

  // LED strip cut-to-length rates. Read is open to all staff (the Strip
  // Cut Counter needs it); update/reset are admin-only server-side.
  getLedStripProducts: () => api.get('/settings/led-strip'),
  updateLedStripProducts: (products: any[]) =>
    api.put('/settings/led-strip', { products }),
  getLedStripDefaults: () => api.get('/settings/led-strip/defaults'),
};

// Sync API (Admin only)
export const syncApi = {
  getStatus: () => api.get('/sync/status'),
  getProgress: () => api.get('/sync/progress'),
  testConnection: () => api.get('/sync/test-connection'),
  syncCategories: () => api.post('/sync/categories'),
  syncProducts: () => api.post('/sync/products'),
  syncCustomers: () => api.post('/sync/customers'),
  syncOrders: () => api.post('/sync/orders'),
  getOrderSyncStatus: () => api.get('/sync/orders-status'),
  pushOrderToMagento: (id: number) => api.post(`/sync/orders/${id}/push`),
  pushPendingPosOrders: () => api.post('/sync/orders/push-pending'),
  syncStock: () => api.post('/sync/stock'),
  fullSync: () => api.post('/sync/full'),
  clearAndSync: () => api.post('/sync/clear-and-sync'),
  // Automatic product sync schedule (manager read, admin write).
  getAutoSync: () => api.get('/sync/auto'),
  updateAutoSync: (cfg: AutoSyncConfig) => api.put('/sync/auto', cfg),
  // Website orders into the POS every 15 minutes, view-only (manager
  // read, admin write).
  getWebsiteOrders: () => api.get('/sync/website-orders'),
  setWebsiteOrders: (enabled: boolean) => api.put('/sync/website-orders', { enabled }),
  importWebsiteOrders: () => api.post('/sync/website-orders/import'),
};

export type AutoSyncMode = 'off' | 'interval' | 'daily';
export interface AutoSyncConfig {
  mode: AutoSyncMode;
  intervalMinutes: number;
  dailyTime: string;
}
export interface AutoSyncState {
  config: AutoSyncConfig;
  busy: boolean;
  lastProductSyncAt: string | null;
  lastAutoRunAt: string | null;
  lastAutoResult: { success: boolean; message: string } | null;
  // ISO timestamp for interval mode, "today HH:MM" / "tomorrow HH:MM" for daily.
  nextRunLabel: string | null;
  timezone: string;
}

// Competitor API
export const competitorApi = {
  getPrice: (productName: string, sku?: string) =>
    api.get('/competitor/price', { params: { name: productName, sku } }),
  // Every competitor's latest weekly Price Watch price for the SKU.
  getPrices: (sku: string) => api.get('/competitor/prices', { params: { sku } }),
};

// Price Watch dashboard (Admin only) — weekly competitor scrape results
export interface PriceWatchFilters {
  search?: string;
  supplier?: string;
  category?: string;
  competitor?: string;
  verdict?: string;
  moversOnly?: boolean;
}

export const priceWatchApi = {
  getSummary: () => api.get('/price-watch/summary'),
  getProducts: (params: PriceWatchFilters & { page?: number; limit?: number }) =>
    api.get('/price-watch/products', { params }),
  // Blob so the authenticated download can be handed to the browser.
  exportCsv: (params: PriceWatchFilters) =>
    api.get('/price-watch/export', { params, responseType: 'blob' }),
};

export default api;
