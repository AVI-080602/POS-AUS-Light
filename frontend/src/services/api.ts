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

  createOrder: (data: any) => api.post('/orders', data),

  linkCustomer: (orderId: number, customerId: number) =>
    api.patch(`/orders/${orderId}/customer`, { customerId }),

  updateNotes: (orderId: number, notes: string | null) =>
    api.patch(`/orders/${orderId}/notes`, { notes }),

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
    }>,
  ) => api.patch(`/orders/${orderId}/items`, { items }),

  // Correct a previously-recorded payment amount (cashier typo).
  // Doesn't refund; use refundOrder for actual money back.
  adjustPayment: (orderId: number, paymentId: number, amount: number) =>
    api.patch(`/orders/${orderId}/payments/${paymentId}`, { amount }),

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
};

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
};

// Competitor API
export const competitorApi = {
  getPrice: (productName: string, sku?: string) =>
    api.get('/competitor/price', { params: { name: productName, sku } }),
};

export default api;
