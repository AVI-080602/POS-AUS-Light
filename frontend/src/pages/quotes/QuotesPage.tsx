import { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import { quotesApi, customersApi, productsApi, settingsApi } from '../../services/api';
import {
  isProductOnSale,
  effectiveProductPrice,
} from '../../store/slices/productsSlice';
import {
  MagnifyingGlassIcon,
  EyeIcon,
  ClockIcon,
  PlusIcon,
  PlusCircleIcon,
  TrashIcon,
  XMarkIcon,
  ArrowLeftIcon,
  PencilIcon,
  ArrowRightCircleIcon,
  PrinterIcon,
  NoSymbolIcon,
} from '@heroicons/react/24/outline';

interface Quote {
  id: number;
  quoteNumber: string;
  status: string;
  grandTotal: number;
  customer: { id: number; firstName: string; lastName: string } | null;
  user: { id: number; firstName: string; lastName: string };
  itemCount: number;
  expiresAt: string;
  createdAt: string;
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

interface QuoteLineItem {
  productId: number;
  name: string;
  sku: string;
  price: number;
  quantity: number;
  // What the cashier typed in the Disc% box (manual override)
  discountPercent: number;
  // Server-computed trade auto-discount (0 when buyerType=customer or
  // no rule matches). Effective per-line discount = max(manual, auto).
  autoDiscountPercent?: number;
  autoDiscountLabel?: string | null;
}

export default function QuotesPage() {
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [pagination, setPagination] = useState<Pagination>({ page: 1, limit: 20, total: 0, totalPages: 0 });
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedQuote, setSelectedQuote] = useState<any>(null);
  const [statusFilter, setStatusFilter] = useState<string>('');

  // Create Quote modal state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [customerSearch, setCustomerSearch] = useState('');
  const [customerResults, setCustomerResults] = useState<any[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<any>(null);
  // Individual controlled inputs for the create-quote customer search
  const [custSearchName, setCustSearchName] = useState('');
  const [custSearchEmail, setCustSearchEmail] = useState('');
  const [custSearchPhone, setCustSearchPhone] = useState('');
  const [productSearch, setProductSearch] = useState('');
  const [productResults, setProductResults] = useState<any[]>([]);
  const [lineItems, setLineItems] = useState<QuoteLineItem[]>([]);
  const [quoteNotes, setQuoteNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [createError, setCreateError] = useState('');
  const [showCustomItem, setShowCustomItem] = useState(false);
  const [customItemName, setCustomItemName] = useState('');
  const [customItemPrice, setCustomItemPrice] = useState('');
  const [customItemSku, setCustomItemSku] = useState('');
  const [quoteBuyerType, setQuoteBuyerType] = useState<'trade' | 'customer'>('customer');
  const [editingQuoteId, setEditingQuoteId] = useState<number | null>(null);

  // Inline "create new customer" panel for the quote modal. Previously
  // the quote could only attach an existing customer, so a brand-new
  // walk-in had nowhere to go (Sally: "Can not add another new customer
  // doesn't create the quote").
  const [showNewCustomer, setShowNewCustomer] = useState(false);
  const [isCreatingCustomer, setIsCreatingCustomer] = useState(false);
  const emptyNewCustomer = {
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    company: '',
    billingStreet: '',
    billingCity: '',
    billingState: '',
    billingPostcode: '',
  };
  const [newCustomer, setNewCustomer] = useState({ ...emptyNewCustomer });

  // Convert / cancel / print state
  const [convertData, setConvertData] = useState<any>(null); // { quote, check }
  const [isConverting, setIsConverting] = useState(false);
  // "Has the customer paid?" gate before actually firing the convert
  // request. Same pattern as the POS Complete Payment confirm.
  const [showConvertConfirm, setShowConvertConfirm] = useState(false);
  const [convertPaymentMethod, setConvertPaymentMethod] = useState<'cash' | 'eftpos' | 'bank_transfer'>('eftpos');
  const [convertPaymentRef, setConvertPaymentRef] = useState('');
  const [allowBackorder, setAllowBackorder] = useState(false);
  const [cancelConfirm, setCancelConfirm] = useState<any>(null);
  const [printingQuote, setPrintingQuote] = useState<any>(null);
  const [storeSettings, setStoreSettings] = useState<any>({});

  useEffect(() => {
    fetchQuotes();
  }, [pagination.page, statusFilter]);

  useEffect(() => {
    settingsApi.getStoreSettings().then((r) => setStoreSettings(r.data.data || {})).catch(() => {});
  }, []);

  // Refresh per-line trade auto-discount whenever the buyer flips
  // between trade/customer or the set of productIds in the quote
  // changes. Customer mode → all autos go to 0 instantly; trade mode
  // → server tells us the % per product.
  useEffect(() => {
    if (lineItems.length === 0) return;
    if (quoteBuyerType !== 'trade') {
      // Clear any previously-applied auto values so total recomputes.
      setLineItems((prev) =>
        prev.some((li) => (li.autoDiscountPercent || 0) > 0)
          ? prev.map((li) => ({
              ...li,
              autoDiscountPercent: 0,
              autoDiscountLabel: null,
            }))
          : prev,
      );
      return;
    }
    // Trade: only ask the server about productIds we haven't priced yet
    // OR if the buyerType just flipped to trade (autoDiscountPercent
    // undefined). Send all real productIds; backend ignores customs.
    const ids = Array.from(
      new Set(
        lineItems
          .filter((li) => Number.isFinite(li.productId) && li.productId > 0)
          .map((li) => li.productId),
      ),
    );
    if (ids.length === 0) return;
    let cancelled = false;
    quotesApi
      .tradeDiscountPreview(ids)
      .then((r) => {
        if (cancelled) return;
        const map: Record<
          number,
          { percent: number; label: string | null }
        > = r.data?.data?.discounts || {};
        setLineItems((prev) =>
          prev.map((li) => {
            const hit = map[li.productId];
            return {
              ...li,
              autoDiscountPercent: hit ? hit.percent : 0,
              autoDiscountLabel: hit ? hit.label : null,
            };
          }),
        );
      })
      .catch(() => {
        // Preview is non-essential — silently fall back to no auto so
        // the user can still build the quote. Backend re-applies on
        // save anyway.
      });
    return () => {
      cancelled = true;
    };
    // Re-run whenever buyer type or the product-id set changes. We
    // intentionally compare ids by joined string so adding/removing a
    // line refetches but per-quantity edits don't.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    quoteBuyerType,
    lineItems
      .map((li) => li.productId)
      .sort()
      .join(','),
  ]);

  const fetchQuotes = async () => {
    try {
      setIsLoading(true);
      const response = await quotesApi.getQuotes({
        status: statusFilter || undefined,
        page: pagination.page,
        limit: 20,
      });
      setQuotes(response.data.data.quotes);
      setPagination(response.data.data.pagination);
    } catch (error) {
      console.error('Failed to fetch quotes:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const viewQuote = async (id: number) => {
    try {
      const response = await quotesApi.getQuote(id);
      setSelectedQuote(response.data.data.quote);
    } catch (error) {
      console.error('Failed to fetch quote:', error);
    }
  };

  // Customer search for create modal
  const [customerSearchLoading, setCustomerSearchLoading] = useState(false);
  const [customerSearchError, setCustomerSearchError] = useState<string | null>(null);

  useEffect(() => {
    if (customerSearch.length < 2) {
      setCustomerResults([]);
      setCustomerSearchLoading(false);
      setCustomerSearchError(null);
      return;
    }
    setCustomerSearchLoading(true);
    setCustomerSearchError(null);
    const timer = setTimeout(async () => {
      try {
        const response = await customersApi.getCustomers({ search: customerSearch, limit: 10 });
        setCustomerResults(response.data.data?.customers || []);
      } catch (err: any) {
        setCustomerResults([]);
        setCustomerSearchError(
          err?.response?.data?.message || err?.message || 'Search failed',
        );
      } finally {
        setCustomerSearchLoading(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [customerSearch]);

  // Product search for create modal
  useEffect(() => {
    if (productSearch.length < 2) {
      setProductResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const response = await productsApi.getProducts({ search: productSearch, limit: 5 });
        setProductResults(response.data.data?.products || []);
      } catch {
        setProductResults([]);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [productSearch]);

  const addLineItem = (product: any) => {
    // Don't add duplicate
    if (lineItems.find((li) => li.productId === product.id)) return;
    // Trade base is always fixed retail so the auto trade discount
    // doesn't stack on top of an active SALE price. Retail uses the
    // sale price when active.
    const basePrice =
      quoteBuyerType === 'trade'
        ? Number(product.price)
        : effectiveProductPrice(product);
    setLineItems([
      ...lineItems,
      {
        productId: product.id,
        name: product.name,
        sku: product.sku,
        price: basePrice,
        quantity: 1,
        discountPercent: 0,
      },
    ]);
    setProductSearch('');
    setProductResults([]);
  };

  const addCustomLineItem = () => {
    const price = parseFloat(customItemPrice);
    if (!customItemName.trim() || isNaN(price) || price <= 0) return;
    setLineItems([
      ...lineItems,
      {
        productId: -Date.now(),
        name: customItemName.trim(),
        sku: customItemSku.trim() || 'CUSTOM',
        price,
        quantity: 1,
        discountPercent: 0,
      },
    ]);
    setShowCustomItem(false);
    setCustomItemName('');
    setCustomItemPrice('');
    setCustomItemSku('');
  };

  const updateLineItem = (index: number, field: keyof QuoteLineItem, value: number) => {
    const updated = [...lineItems];
    (updated[index] as any)[field] = value;
    setLineItems(updated);
  };

  const removeLineItem = (index: number) => {
    setLineItems(lineItems.filter((_, i) => i !== index));
  };

  // Effective discount per line — cashier override wins when higher,
  // trade auto-discount wins otherwise. Mirrors the backend save logic.
  const effectiveDiscount = (item: QuoteLineItem) =>
    Math.max(item.discountPercent || 0, item.autoDiscountPercent || 0);

  const getLineTotal = (item: QuoteLineItem) => {
    const sub = item.price * item.quantity;
    const disc = sub * (effectiveDiscount(item) / 100);
    return sub - disc;
  };

  const getQuoteSubtotal = () => lineItems.reduce((sum, li) => sum + li.price * li.quantity, 0);
  const getQuoteDiscount = () =>
    lineItems.reduce(
      (sum, li) => sum + li.price * li.quantity * (effectiveDiscount(li) / 100),
      0,
    );
  const getQuoteTax = () => (getQuoteSubtotal() - getQuoteDiscount()) * 0.1;
  const getQuoteTotal = () => getQuoteSubtotal() - getQuoteDiscount() + getQuoteTax();

  const handleCreateQuote = async () => {
    if (lineItems.length === 0) {
      setCreateError('Add at least one product');
      return;
    }
    setCreateError('');
    setIsSubmitting(true);
    try {
      const payload = {
        customerId: selectedCustomer?.id || undefined,
        items: lineItems.map((li) => ({
          productId: li.productId,
          quantity: li.quantity,
          unitPrice: li.price,
          discountPercent: li.discountPercent || 0,
        })),
        notes: quoteNotes || undefined,
        buyerType: quoteBuyerType,
      };
      if (editingQuoteId) {
        await quotesApi.updateQuote(editingQuoteId, payload);
        toast.success('Quote updated');
      } else {
        await quotesApi.createQuote(payload);
        toast.success('Quote created');
      }
      // Reset and close
      setShowCreateModal(false);
      resetCreateForm();
      fetchQuotes();
      if (editingQuoteId && selectedQuote && editingQuoteId === selectedQuote.id) {
        // Refresh the detail view
        viewQuote(editingQuoteId);
      }
    } catch (error: any) {
      setCreateError(error.response?.data?.message || 'Failed to save quote');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Create a customer straight from the quote modal and attach them to
  // the quote being built. Trade quotes flag the customer as trade so
  // the auto trade rates apply from here on.
  const handleCreateCustomerForQuote = async () => {
    if (!newCustomer.firstName.trim()) {
      setCreateError('Customer first name is required');
      return;
    }
    if (newCustomer.phone && !/^\d{10}$/.test(newCustomer.phone.replace(/\D/g, ''))) {
      setCreateError('Phone number must be 10 digits');
      return;
    }
    setCreateError('');
    setIsCreatingCustomer(true);
    try {
      const res = await customersApi.createCustomer({
        firstName: newCustomer.firstName.trim(),
        lastName: newCustomer.lastName.trim() || undefined,
        email: newCustomer.email.trim() || undefined,
        phone: newCustomer.phone.trim() || undefined,
        company: newCustomer.company.trim() || undefined,
        billingStreet: newCustomer.billingStreet.trim() || undefined,
        billingCity: newCustomer.billingCity.trim() || undefined,
        billingState: newCustomer.billingState.trim() || undefined,
        billingPostcode: newCustomer.billingPostcode.trim() || undefined,
        isTrade: quoteBuyerType === 'trade',
      });
      const created = res.data?.data?.customer ?? res.data?.data ?? res.data;
      setSelectedCustomer(created);
      setShowNewCustomer(false);
      setNewCustomer({ ...emptyNewCustomer });
      setCustomerSearch('');
      setCustSearchName('');
      setCustSearchEmail('');
      setCustSearchPhone('');
      setCustomerResults([]);
      toast.success('Customer created');
    } catch (error: any) {
      setCreateError(
        error.response?.data?.message || 'Failed to create customer',
      );
    } finally {
      setIsCreatingCustomer(false);
    }
  };

  const resetCreateForm = () => {
    setSelectedCustomer(null);
    setShowNewCustomer(false);
    setNewCustomer({ ...emptyNewCustomer });
    setCustomerSearch('');
    setCustSearchName('');
    setCustSearchEmail('');
    setCustSearchPhone('');
    setCustomerResults([]);
    setProductSearch('');
    setLineItems([]);
    setQuoteNotes('');
    setCreateError('');
    setQuoteBuyerType('customer');
    setEditingQuoteId(null);
  };

  const openEditQuote = (quote: any) => {
    setEditingQuoteId(quote.id);
    setSelectedCustomer(quote.customer || null);
    setLineItems(
      (quote.items || []).map((item: any) => ({
        productId: item.productId,
        name: item.name,
        sku: item.sku,
        price: parseFloat(item.unitPrice),
        quantity: item.quantity,
        discountPercent: parseFloat(item.discountPercent),
      })),
    );
    setQuoteNotes(quote.notes || '');
    setQuoteBuyerType(quote.buyerType || 'customer');
    setCreateError('');
    setSelectedQuote(null);
    setShowCreateModal(true);
  };

  const openConvertFlow = async (quote: any) => {
    try {
      const res = await quotesApi.convertCheck(quote.id);
      const check = res.data.data;
      setConvertData({ quote, check });
      setConvertPaymentMethod('eftpos');
      setConvertPaymentRef('');
      setAllowBackorder(false);
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Failed to check quote');
    }
  };

  const handleConvertSubmit = async (skipConfirm: boolean = false) => {
    if (!convertData) return;
    const { quote, check } = convertData;
    // Prefer the server-calculated payable amount (gross / GST-inclusive
    // convention used by the orders service). Falls back to the quote's
    // stored grandTotal for safety. Old quotes that pre-date the GST
    // fix had grandTotal stored at +10% on top, which would mismatch.
    const payable =
      typeof check.payableAmount === 'number'
        ? check.payableAmount
        : parseFloat(quote.grandTotal);

    // Pause and confirm before hitting the API so the cashier doesn't
    // accidentally close out a quote with no money received.
    if (!skipConfirm) {
      setShowConvertConfirm(true);
      return;
    }

    setIsConverting(true);
    try {
      const res = await quotesApi.convertToOrder(quote.id, {
        payments: [
          {
            method: convertPaymentMethod,
            amount: payable,
            reference: convertPaymentRef || undefined,
            amountTendered:
              convertPaymentMethod === 'cash' ? payable : undefined,
          },
        ],
        allowBackorder: allowBackorder && !!check.blockers.outOfStock,
      });
      toast.success(`Converted to order ${res.data.data.order.orderNumber}`);
      setConvertData(null);
      setSelectedQuote(null);
      fetchQuotes();
    } catch (error: any) {
      const msg = error.response?.data?.message;
      toast.error(typeof msg === 'string' ? msg : 'Failed to convert quote');
    } finally {
      setIsConverting(false);
    }
  };

  const handleCancelQuote = async () => {
    if (!cancelConfirm) return;
    try {
      await quotesApi.cancelQuote(cancelConfirm.id);
      toast.success('Quote cancelled');
      setCancelConfirm(null);
      setSelectedQuote(null);
      fetchQuotes();
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Failed to cancel quote');
    }
  };

  // Grace period helper used by the view modal
  const getExpiryState = (quote: any): 'valid' | 'within_grace' | 'past_grace' => {
    const now = new Date();
    const expires = new Date(quote.expiresAt);
    if (now <= expires) return 'valid';
    const graceDays = quote.buyerType === 'trade' ? 30 : 15;
    const graceEnd = new Date(expires);
    graceEnd.setDate(graceEnd.getDate() + graceDays);
    return now > graceEnd ? 'past_grace' : 'within_grace';
  };

  const formatDate = (date: string) => {
    return new Date(date).toLocaleDateString('en-AU', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  };

  const getStatusBadge = (status: string) => {
    const colors: Record<string, string> = {
      open: 'bg-blue-600',
      expired: 'bg-gray-600',
      converted: 'bg-green-600',
      cancelled: 'bg-red-600',
    };
    return (
      <span className={`px-2 py-1 rounded text-xs font-medium ${colors[status] || 'bg-gray-600'}`}>
        {status.toUpperCase()}
      </span>
    );
  };

  const isExpired = (expiresAt: string) => new Date() > new Date(expiresAt);

  const filteredQuotes = quotes.filter(
    (quote) =>
      quote.quoteNumber.toLowerCase().includes(search.toLowerCase()) ||
      quote.customer?.firstName?.toLowerCase().includes(search.toLowerCase()) ||
      quote.customer?.lastName?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="h-full p-6 overflow-auto">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Quotes</h1>
        <div className="flex items-center gap-4">
          <span className="text-sm text-gray-400">Total: {pagination.total} quotes</span>
          <button
            className="btn-primary flex items-center gap-2"
            onClick={() => { resetCreateForm(); setShowCreateModal(true); }}
          >
            <PlusIcon className="h-5 w-5" />
            Create Quote
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-4 mb-4">
        <div className="relative flex-1">
          <MagnifyingGlassIcon className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
          <input
            type="text"
            placeholder="Search by quote number or customer..."
            className="input pl-12"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select
          className="input w-40"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="">All Status</option>
          <option value="open">Open</option>
          <option value="expired">Expired</option>
          <option value="converted">Converted</option>
          <option value="cancelled">Cancelled</option>
        </select>
      </div>

      {/* Quotes Table */}
      <div className="card overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-gray-400">Loading quotes...</div>
        ) : filteredQuotes.length === 0 ? (
          <div className="p-8 text-center text-gray-400">No quotes found</div>
        ) : (
          <table className="w-full">
            <thead className="bg-pos-accent">
              <tr>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-300">Quote #</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-300">Customer</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-300">Items</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-300">Total</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-300">Status</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-300">Expires</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-300">Created By</th>
                <th className="px-4 py-3 text-center text-sm font-medium text-gray-300">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700">
              {filteredQuotes.map((quote) => (
                <tr key={quote.id} className="hover:bg-pos-accent/50">
                  <td className="px-4 py-3 font-medium">{quote.quoteNumber}</td>
                  <td className="px-4 py-3">
                    {quote.customer
                      ? `${quote.customer.firstName} ${quote.customer.lastName}`
                      : 'Walk-in'}
                  </td>
                  <td className="px-4 py-3">{quote.itemCount}</td>
                  <td className="px-4 py-3 font-medium">${quote.grandTotal.toFixed(2)}</td>
                  <td className="px-4 py-3">{getStatusBadge(quote.status)}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      {isExpired(quote.expiresAt) && quote.status === 'open' && (
                        <ClockIcon className="h-4 w-4 text-red-500" />
                      )}
                      <span className={isExpired(quote.expiresAt) ? 'text-red-400' : ''}>
                        {formatDate(quote.expiresAt)}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3">{quote.user.firstName}</td>
                  <td className="px-4 py-3 text-center">
                    <button
                      onClick={() => viewQuote(quote.id)}
                      className="p-2 hover:bg-pos-accent rounded"
                      title="View Quote"
                    >
                      <EyeIcon className="h-5 w-5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {pagination.totalPages > 1 && (
        <div className="flex justify-center gap-2 mt-4">
          <button
            className="btn-sm"
            disabled={pagination.page <= 1}
            onClick={() => setPagination((p) => ({ ...p, page: p.page - 1 }))}
          >
            Previous
          </button>
          <span className="px-4 py-2 text-sm">
            Page {pagination.page} of {pagination.totalPages}
          </span>
          <button
            className="btn-sm"
            disabled={pagination.page >= pagination.totalPages}
            onClick={() => setPagination((p) => ({ ...p, page: p.page + 1 }))}
          >
            Next
          </button>
        </div>
      )}

      {/* Quote Detail Modal */}
      {selectedQuote && (() => {
        const expiryState = getExpiryState(selectedQuote);
        const status = selectedQuote.status;
        const canEdit = status === 'open' && expiryState !== 'past_grace';
        const canConvert = (status === 'open' || status === 'expired') && expiryState !== 'past_grace';
        const canCancel = status === 'open';
        return (
          <div className="modal-backdrop">
            <div className="modal-content">
              <div className="flex justify-between items-start mb-4">
                <button onClick={() => setSelectedQuote(null)} className="modal-back-btn">
                  <ArrowLeftIcon className="h-5 w-5" /> Back
                </button>
                <div className="text-right">
                  <h2 className="text-xl font-bold">{selectedQuote.quoteNumber}</h2>
                  <div className="flex items-center gap-2 mt-1 flex-wrap justify-end">
                    {getStatusBadge(status)}
                    <span className="px-2 py-0.5 rounded text-xs font-medium bg-gray-700 uppercase">
                      {selectedQuote.buyerType || 'customer'}
                    </span>
                    <span className="text-sm text-gray-400">
                      Created {formatDate(selectedQuote.createdAt)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Status banner */}
              {status === 'converted' && (
                <div className="bg-green-500/10 border border-green-500/40 text-green-300 rounded-lg p-3 mb-4 text-sm">
                  ✓ This quote was converted to Order #{selectedQuote.convertedOrderId}
                </div>
              )}
              {status === 'cancelled' && (
                <div className="bg-red-500/10 border border-red-500/40 text-red-300 rounded-lg p-3 mb-4 text-sm">
                  This quote has been cancelled.
                </div>
              )}
              {status === 'open' && expiryState === 'within_grace' && (
                <div className="bg-orange-500/10 border border-orange-500/40 text-orange-300 rounded-lg p-3 mb-4 text-sm">
                  ⚠ Quote expired on {formatDate(selectedQuote.expiresAt)}. Within grace period — can still convert at quoted prices.
                </div>
              )}
              {status === 'open' && expiryState === 'past_grace' && (
                <div className="bg-red-500/10 border border-red-500/40 text-red-300 rounded-lg p-3 mb-4 text-sm">
                  Quote expired beyond grace period. Create a new quote at current prices.
                </div>
              )}

              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-gray-400">Customer</p>
                    <p>{selectedQuote.customer ? `${selectedQuote.customer.firstName} ${selectedQuote.customer.lastName}` : 'Walk-in'}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-400">Created By</p>
                    <p>{selectedQuote.user?.firstName} {selectedQuote.user?.lastName}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-400">Expires</p>
                    <p className={isExpired(selectedQuote.expiresAt) ? 'text-red-400' : ''}>
                      {formatDate(selectedQuote.expiresAt)}
                    </p>
                  </div>
                </div>

                <div>
                  <p className="text-sm text-gray-400 mb-2">Items</p>
                  <div className="bg-pos-dark rounded p-3 space-y-2">
                    {selectedQuote.items?.map((item: any) => (
                      <div key={item.id} className="flex justify-between text-sm">
                        <span>{item.quantity}x {item.name}</span>
                        <span>${parseFloat(item.rowTotal).toFixed(2)}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="border-t border-gray-700 pt-4">
                  <div className="flex justify-between text-sm">
                    <span>Subtotal</span>
                    <span>${parseFloat(selectedQuote.subtotal).toFixed(2)}</span>
                  </div>
                  {parseFloat(selectedQuote.discountAmount) > 0 && (
                    <div className="flex justify-between text-sm text-green-400">
                      <span>Discount</span>
                      <span>-${parseFloat(selectedQuote.discountAmount).toFixed(2)}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-sm">
                    <span>GST (10%)</span>
                    <span>${parseFloat(selectedQuote.taxAmount).toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between font-bold text-lg mt-2">
                    <span>Total</span>
                    <span>${parseFloat(selectedQuote.grandTotal).toFixed(2)}</span>
                  </div>
                </div>

                {selectedQuote.notes && (
                  <div>
                    <p className="text-sm text-gray-400">Notes</p>
                    <p className="text-sm">{selectedQuote.notes}</p>
                  </div>
                )}
              </div>

              {/* Action bar */}
              <div className="flex flex-wrap gap-2 justify-end mt-6 pt-4 border-t border-gray-700">
                <button
                  className="btn-secondary flex items-center gap-2"
                  onClick={() => setPrintingQuote(selectedQuote)}
                >
                  <PrinterIcon className="h-4 w-4" />
                  Print
                </button>
                {canEdit && (
                  <button
                    className="btn-secondary flex items-center gap-2"
                    onClick={() => openEditQuote(selectedQuote)}
                  >
                    <PencilIcon className="h-4 w-4" />
                    Edit
                  </button>
                )}
                {canCancel && (
                  <button
                    className="bg-red-600/80 hover:bg-red-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 text-sm"
                    onClick={() => setCancelConfirm(selectedQuote)}
                  >
                    <NoSymbolIcon className="h-4 w-4" />
                    Cancel Quote
                  </button>
                )}
                {canConvert && (
                  <button
                    className="btn-primary flex items-center gap-2"
                    onClick={() => openConvertFlow(selectedQuote)}
                  >
                    <ArrowRightCircleIcon className="h-4 w-4" />
                    Convert to Order
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* Create Quote Modal */}
      {showCreateModal && (
        <div className="modal-backdrop">
          <div className="modal-content">
            <div className="flex justify-between items-center mb-6">
              <button onClick={() => { setShowCreateModal(false); resetCreateForm(); }} className="modal-back-btn">
                <ArrowLeftIcon className="h-5 w-5" /> Back
              </button>
              <h2 className="text-xl font-bold">
                {editingQuoteId ? `Edit Quote #${editingQuoteId}` : 'Create Quote'}
              </h2>
            </div>

            {/* Buyer Type Toggle */}
            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-300 mb-2">Quote Type</label>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  className={`p-3 rounded-lg border-2 font-medium transition-colors ${
                    quoteBuyerType === 'trade'
                      ? 'border-orange-500 bg-orange-500/20 text-orange-300'
                      : 'border-gray-600 text-gray-400 hover:border-gray-500'
                  }`}
                  onClick={() => setQuoteBuyerType('trade')}
                >
                  Trade (90 day expiry)
                </button>
                <button
                  type="button"
                  className={`p-3 rounded-lg border-2 font-medium transition-colors ${
                    quoteBuyerType === 'customer'
                      ? 'border-blue-500 bg-blue-500/20 text-blue-300'
                      : 'border-gray-600 text-gray-400 hover:border-gray-500'
                  }`}
                  onClick={() => setQuoteBuyerType('customer')}
                >
                  Customer (30 day expiry)
                </button>
              </div>
            </div>

            {/* Customer Section */}
            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-300 mb-2">Customer</label>
              {selectedCustomer ? (
                <div className="flex items-center justify-between bg-pos-accent rounded-lg p-3">
                  <div>
                    <p className="font-medium">{selectedCustomer.firstName} {selectedCustomer.lastName}</p>
                    <p className="text-sm text-gray-400">
                      {selectedCustomer.email && <span>{selectedCustomer.email}</span>}
                      {selectedCustomer.email && selectedCustomer.phone && <span> | </span>}
                      {selectedCustomer.phone && <span>{selectedCustomer.phone}</span>}
                    </p>
                  </div>
                  <button
                    onClick={() => { setSelectedCustomer(null); setCustomerSearch(''); }}
                    className="text-gray-400 hover:text-red-400"
                  >
                    <XMarkIcon className="h-5 w-5" />
                  </button>
                </div>
              ) : (
                <div>
                  <div className="grid grid-cols-3 gap-3 mb-2">
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">Customer Name</label>
                      <input
                        type="text"
                        placeholder="Search by name"
                        className="input"
                        autoComplete="off"
                        value={custSearchName}
                        onChange={(e) => {
                          setCustSearchName(e.target.value);
                          setCustSearchEmail('');
                          setCustSearchPhone('');
                          setCustomerSearch(e.target.value);
                        }}
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">Email</label>
                      <input
                        type="email"
                        placeholder="Search by email"
                        className="input"
                        autoComplete="off"
                        value={custSearchEmail}
                        onChange={(e) => {
                          setCustSearchEmail(e.target.value);
                          setCustSearchName('');
                          setCustSearchPhone('');
                          setCustomerSearch(e.target.value);
                        }}
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">Phone Number</label>
                      <input
                        type="tel"
                        placeholder="Search by phone"
                        className="input"
                        autoComplete="off"
                        value={custSearchPhone}
                        onChange={(e) => {
                          setCustSearchPhone(e.target.value);
                          setCustSearchName('');
                          setCustSearchEmail('');
                          setCustomerSearch(e.target.value);
                        }}
                      />
                    </div>
                  </div>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs text-gray-500">
                      Start typing in any field — results appear below
                    </p>
                    <button
                      type="button"
                      className="text-xs font-semibold text-primary-400 hover:text-primary-300"
                      onClick={() => setShowNewCustomer((v) => !v)}
                    >
                      {showNewCustomer ? 'Cancel new customer' : '+ Create new customer'}
                    </button>
                  </div>

                  {/* New-customer form — first/last name split, address
                      fields, and Company Name for trade buyers. */}
                  {showNewCustomer && (
                    <div className="bg-pos-accent border border-gray-600 rounded-lg p-4 mb-3">
                      <p className="text-sm font-semibold mb-3">
                        New {quoteBuyerType === 'trade' ? 'Trade' : 'Customer'} Details
                      </p>
                      <div className="grid grid-cols-2 gap-3 mb-3">
                        <div>
                          <label className="block text-xs text-gray-400 mb-1">
                            First Name *
                          </label>
                          <input
                            type="text"
                            className="input"
                            value={newCustomer.firstName}
                            onChange={(e) =>
                              setNewCustomer({ ...newCustomer, firstName: e.target.value })
                            }
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-gray-400 mb-1">
                            Last Name
                          </label>
                          <input
                            type="text"
                            className="input"
                            value={newCustomer.lastName}
                            onChange={(e) =>
                              setNewCustomer({ ...newCustomer, lastName: e.target.value })
                            }
                          />
                        </div>
                      </div>

                      {quoteBuyerType === 'trade' && (
                        <div className="mb-3">
                          <label className="block text-xs text-gray-400 mb-1">
                            Company Name
                          </label>
                          <input
                            type="text"
                            className="input w-full"
                            value={newCustomer.company}
                            onChange={(e) =>
                              setNewCustomer({ ...newCustomer, company: e.target.value })
                            }
                          />
                        </div>
                      )}

                      <div className="grid grid-cols-2 gap-3 mb-3">
                        <div>
                          <label className="block text-xs text-gray-400 mb-1">Phone</label>
                          <input
                            type="tel"
                            className="input"
                            placeholder="10 digits"
                            value={newCustomer.phone}
                            onChange={(e) =>
                              setNewCustomer({
                                ...newCustomer,
                                // Digits only — staff kept typing letters here.
                                phone: e.target.value.replace(/\D/g, '').slice(0, 10),
                              })
                            }
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-gray-400 mb-1">Email</label>
                          <input
                            type="email"
                            className="input"
                            value={newCustomer.email}
                            onChange={(e) =>
                              setNewCustomer({ ...newCustomer, email: e.target.value })
                            }
                          />
                        </div>
                      </div>

                      <label className="block text-xs text-gray-400 mb-1">Address</label>
                      <input
                        type="text"
                        className="input w-full mb-2"
                        placeholder="Street address"
                        value={newCustomer.billingStreet}
                        onChange={(e) =>
                          setNewCustomer({ ...newCustomer, billingStreet: e.target.value })
                        }
                      />
                      <div className="grid grid-cols-3 gap-3 mb-3">
                        <input
                          type="text"
                          className="input"
                          placeholder="Suburb / City"
                          value={newCustomer.billingCity}
                          onChange={(e) =>
                            setNewCustomer({ ...newCustomer, billingCity: e.target.value })
                          }
                        />
                        <input
                          type="text"
                          className="input"
                          placeholder="State"
                          value={newCustomer.billingState}
                          onChange={(e) =>
                            setNewCustomer({ ...newCustomer, billingState: e.target.value })
                          }
                        />
                        <input
                          type="text"
                          className="input"
                          placeholder="Postcode"
                          value={newCustomer.billingPostcode}
                          onChange={(e) =>
                            setNewCustomer({
                              ...newCustomer,
                              billingPostcode: e.target.value.replace(/\D/g, '').slice(0, 4),
                            })
                          }
                        />
                      </div>

                      <button
                        type="button"
                        className="btn-primary w-full"
                        disabled={isCreatingCustomer}
                        onClick={handleCreateCustomerForQuote}
                      >
                        {isCreatingCustomer ? 'Creating…' : 'Create & Add Customer'}
                      </button>
                    </div>
                  )}

                  {customerSearch.length >= 2 && (
                    <div className="bg-pos-accent border border-gray-600 rounded-lg max-h-48 overflow-auto">
                      {customerSearchLoading && (
                        <div className="px-4 py-3 text-sm text-gray-400">Searching…</div>
                      )}
                      {customerSearchError && !customerSearchLoading && (
                        <div className="px-4 py-3 text-sm text-red-400">
                          Error: {customerSearchError}
                        </div>
                      )}
                      {!customerSearchLoading &&
                        !customerSearchError &&
                        customerResults.length === 0 && (
                          <div className="px-4 py-3 text-sm text-gray-400">
                            No customers matched “{customerSearch}”
                          </div>
                        )}
                      {customerResults.map((c: any) => (
                        <button
                          key={c.id}
                          className="w-full text-left px-4 py-3 hover:bg-pos-card border-b border-gray-700 last:border-0"
                          onClick={() => {
                            setSelectedCustomer(c);
                            setCustomerSearch('');
                            setCustSearchName('');
                            setCustSearchEmail('');
                            setCustSearchPhone('');
                            setCustomerResults([]);
                          }}
                        >
                          <p className="font-medium">{c.firstName} {c.lastName}</p>
                          <p className="text-xs text-gray-400">
                            ID: {c.id} {c.email ? `| ${c.email}` : ''} {c.phone ? `| ${c.phone}` : ''}
                          </p>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Products Section */}
            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-300 mb-2">Add Products</label>
              <div className="grid grid-cols-2 gap-3 mb-2">
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Product Name / SKU</label>
                  <input
                    type="text"
                    placeholder="Search by name or SKU"
                    className="input"
                    value={productSearch}
                    onChange={(e) => setProductSearch(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Product ID</label>
                  <input
                    type="number"
                    placeholder="Enter product ID"
                    className="input"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        const val = (e.target as HTMLInputElement).value.trim();
                        if (val) {
                          setProductSearch(val);
                        }
                      }
                    }}
                  />
                </div>
              </div>
              {productResults.length > 0 && (
                <div className="bg-pos-accent border border-gray-600 rounded-lg max-h-48 overflow-auto">
                  {productResults.map((p: any) => {
                    const onSale = isProductOnSale(p);
                    const price = effectiveProductPrice(p);
                    return (
                    <button
                      key={p.id}
                      className="w-full text-left px-4 py-3 hover:bg-pos-card border-b border-gray-700 last:border-0"
                      onClick={() => addLineItem(p)}
                    >
                      <div className="flex justify-between">
                        <div>
                          <p className="font-medium">{p.name}</p>
                          <p className="text-xs text-gray-400">ID: {p.id} | {p.sku}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-primary-400 font-bold">
                            ${price.toFixed(2)}
                          </p>
                          {onSale && (
                            <p className="text-xs text-gray-500 line-through">
                              ${Number(p.price).toFixed(2)}
                            </p>
                          )}
                        </div>
                      </div>
                    </button>
                    );
                  })}
                </div>
              )}

              {/* Custom Item */}
              {!showCustomItem ? (
                <button
                  className="mt-2 btn-sm bg-purple-600 text-white flex items-center gap-1"
                  onClick={() => setShowCustomItem(true)}
                >
                  <PlusCircleIcon className="h-4 w-4" />
                  Custom Item
                </button>
              ) : (
                <div className="mt-2 bg-pos-accent border border-gray-600 rounded-lg p-3">
                  <div className="grid grid-cols-3 gap-2 mb-2">
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">Item Name *</label>
                      <input
                        type="text"
                        className="input w-full"
                        placeholder="e.g. Custom Fitting"
                        value={customItemName}
                        onChange={(e) => setCustomItemName(e.target.value)}
                        autoFocus
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">Price (incl. GST) *</label>
                      <input
                        type="number"
                        className="input w-full"
                        placeholder="0.00"
                        min={0}
                        step={0.01}
                        value={customItemPrice}
                        onChange={(e) => setCustomItemPrice(e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">SKU (optional)</label>
                      <input
                        type="text"
                        className="input w-full"
                        placeholder="CUSTOM-001"
                        value={customItemSku}
                        onChange={(e) => setCustomItemSku(e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      className="btn-sm bg-gray-600 text-white"
                      onClick={() => { setShowCustomItem(false); setCustomItemName(''); setCustomItemPrice(''); setCustomItemSku(''); }}
                    >
                      Cancel
                    </button>
                    <button
                      className="btn-sm bg-purple-600 text-white"
                      onClick={addCustomLineItem}
                      disabled={!customItemName.trim() || !customItemPrice || parseFloat(customItemPrice) <= 0}
                    >
                      Add to Quote
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Line Items Table */}
            {lineItems.length > 0 && (
              <div className="mb-6">
                <table className="w-full text-sm">
                  <thead className="bg-pos-accent">
                    <tr>
                      <th className="px-3 py-2 text-left text-gray-300">Product</th>
                      <th className="px-3 py-2 text-center text-gray-300 w-20">Qty</th>
                      <th className="px-3 py-2 text-right text-gray-300 w-24">
                        {quoteBuyerType === 'trade' ? 'Trade Price *' : 'Price *'}
                      </th>
                      <th className="px-3 py-2 text-center text-gray-300 w-24">Disc %</th>
                      <th className="px-3 py-2 text-right text-gray-300 w-24">Total</th>
                      <th className="px-3 py-2 w-10"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-700">
                    {lineItems.map((item, idx) => (
                      <tr key={item.productId}>
                        <td className="px-3 py-2">
                          <p className="font-medium">{item.name}</p>
                          <p className="text-xs text-gray-400">{item.sku}</p>
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="number"
                            min={1}
                            className="input text-center py-1 px-2 w-16 mx-auto block"
                            value={item.quantity}
                            onChange={(e) => updateLineItem(idx, 'quantity', Math.max(1, parseInt(e.target.value) || 1))}
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="number"
                            min={0}
                            step="0.01"
                            className="input text-right py-1 px-2 w-20 mx-auto block"
                            value={item.price}
                            onChange={(e) => updateLineItem(idx, 'price', Math.max(0, parseFloat(e.target.value) || 0))}
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="number"
                            min={0}
                            max={100}
                            className="input text-center py-1 px-2 w-16 mx-auto block"
                            value={effectiveDiscount(item)}
                            onChange={(e) => updateLineItem(idx, 'discountPercent', Math.min(100, Math.max(0, parseFloat(e.target.value) || 0)))}
                          />
                          {(item.autoDiscountPercent || 0) > 0 &&
                            (item.autoDiscountPercent || 0) >=
                              (item.discountPercent || 0) && (
                              <p
                                className="text-[10px] text-orange-400 mt-1 text-center"
                                title={item.autoDiscountLabel || ''}
                              >
                                trade auto
                              </p>
                            )}
                        </td>
                        <td className="px-3 py-2 text-right font-medium">
                          ${getLineTotal(item).toFixed(2)}
                        </td>
                        <td className="px-3 py-2">
                          <button
                            onClick={() => removeLineItem(idx)}
                            className="text-gray-400 hover:text-red-400"
                          >
                            <TrashIcon className="h-4 w-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {/* Totals */}
                <div className="border-t border-gray-600 mt-2 pt-3 space-y-1 text-sm">
                  <div className="flex justify-between px-3">
                    <span className="text-gray-400">Subtotal</span>
                    <span>${getQuoteSubtotal().toFixed(2)}</span>
                  </div>
                  {getQuoteDiscount() > 0 && (
                    <div className="flex justify-between px-3 text-green-400">
                      <span>Discount</span>
                      <span>-${getQuoteDiscount().toFixed(2)}</span>
                    </div>
                  )}
                  <div className="flex justify-between px-3">
                    <span className="text-gray-400">GST (10%)</span>
                    <span>${getQuoteTax().toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between px-3 font-bold text-lg pt-1 border-t border-gray-700">
                    <span>Total</span>
                    <span>${getQuoteTotal().toFixed(2)}</span>
                  </div>
                </div>
              </div>
            )}

            {/* Notes */}
            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-300 mb-2">Notes (optional)</label>
              <textarea
                className="input min-h-[60px]"
                placeholder="Add any notes for this quote..."
                value={quoteNotes}
                onChange={(e) => setQuoteNotes(e.target.value)}
              />
            </div>

            {/* Error */}
            {createError && (
              <div className="bg-red-500/20 text-red-400 p-3 rounded mb-4 text-sm">{createError}</div>
            )}

            {/* Actions */}
            <div className="flex justify-end gap-3">
              <button
                className="btn-secondary"
                onClick={() => { setShowCreateModal(false); resetCreateForm(); }}
              >
                Cancel
              </button>
              <button
                className="btn-primary"
                onClick={handleCreateQuote}
                disabled={isSubmitting || lineItems.length === 0}
              >
                {isSubmitting
                  ? editingQuoteId ? 'Saving...' : 'Creating...'
                  : editingQuoteId ? 'Save Changes' : 'Create Quote'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Convert to Order Modal */}
      {convertData && (() => {
        const { quote, check } = convertData;
        // Use the server's recomputed payable amount when available
        // (handles legacy quotes whose stored grandTotal was wrong).
        const grandTotal =
          typeof check.payableAmount === 'number'
            ? check.payableAmount
            : parseFloat(quote.grandTotal);
        const hasOutOfStock = !!check.blockers?.outOfStock;
        const pastGrace = !!check.blockers?.expiredPastGrace;
        const expiredWithinGrace = !!check.expiredWithinGrace;
        const priceDropped = (check.prices || []).some((p: any) => p.priceDropped);
        return (
          <div className="modal-backdrop-top">
            <div className="modal-content">
              <div className="flex justify-between items-start mb-4">
                <button onClick={() => setConvertData(null)} className="modal-back-btn">
                  <ArrowLeftIcon className="h-5 w-5" /> Back
                </button>
                <h2 className="text-xl font-bold">Convert Quote {quote.quoteNumber}</h2>
              </div>

              {pastGrace && (
                <div className="bg-red-500/15 border border-red-500/50 text-red-300 p-3 rounded mb-4 text-sm">
                  Quote expired beyond the grace period. Cannot convert — create a new quote instead.
                </div>
              )}
              {expiredWithinGrace && !pastGrace && (
                <div className="bg-orange-500/15 border border-orange-500/50 text-orange-300 p-3 rounded mb-4 text-sm">
                  ⚠ This quote has expired but is still within the grace period. Proceeding will honour the quoted prices.
                </div>
              )}
              {priceDropped && (
                <div className="bg-blue-500/15 border border-blue-500/50 text-blue-300 p-3 rounded mb-4 text-sm">
                  ℹ Some products are now cheaper than when quoted. The lower price will be used.
                </div>
              )}
              {hasOutOfStock && (
                <div className="bg-red-500/15 border border-red-500/50 text-red-300 p-3 rounded mb-4 text-sm">
                  <p className="font-semibold mb-1">Out of stock:</p>
                  <ul className="list-disc list-inside space-y-0.5">
                    {check.blockers.outOfStock.map((oos: any) => (
                      <li key={oos.sku}>
                        {oos.name} ({oos.sku}) — requested {oos.requested}, available {oos.available}
                      </li>
                    ))}
                  </ul>
                  <label className="flex items-center gap-2 mt-3 text-xs">
                    <input
                      type="checkbox"
                      checked={allowBackorder}
                      onChange={(e) => setAllowBackorder(e.target.checked)}
                      className="w-4 h-4"
                    />
                    <span>Override (admin/manager only — creates a back-order)</span>
                  </label>
                </div>
              )}

              <div className="bg-pos-dark rounded p-3 mb-4 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-400">Customer</span>
                  <span>
                    {quote.customer
                      ? `${quote.customer.firstName} ${quote.customer.lastName}`
                      : 'Walk-in'}
                  </span>
                </div>
                <div className="flex justify-between mt-1">
                  <span className="text-gray-400">Items</span>
                  <span>{quote.items?.length || 0}</span>
                </div>
                <div className="flex justify-between mt-1 font-bold text-base">
                  <span>Amount Due</span>
                  <span>${grandTotal.toFixed(2)}</span>
                </div>
              </div>

              <div className="mb-4">
                <label className="block text-sm text-gray-400 mb-2">Payment Method</label>
                <div className="grid grid-cols-3 gap-2">
                  {(['eftpos', 'cash', 'bank_transfer'] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      className={`p-3 rounded-lg border-2 text-sm font-medium ${
                        convertPaymentMethod === m
                          ? 'border-primary-500 bg-primary-500/20'
                          : 'border-gray-600'
                      }`}
                      onClick={() => setConvertPaymentMethod(m)}
                    >
                      {m === 'eftpos' ? 'EFTPOS' : m === 'cash' ? 'Cash' : 'Bank Transfer'}
                    </button>
                  ))}
                </div>
              </div>

              {convertPaymentMethod !== 'cash' && (
                <div className="mb-4">
                  <label className="block text-sm text-gray-400 mb-1">Reference (optional)</label>
                  <input
                    type="text"
                    className="input"
                    value={convertPaymentRef}
                    onChange={(e) => setConvertPaymentRef(e.target.value)}
                  />
                </div>
              )}

              <div className="flex justify-end gap-3 pt-4 border-t border-gray-700">
                <button
                  className="btn-secondary"
                  onClick={() => setConvertData(null)}
                  disabled={isConverting}
                >
                  Cancel
                </button>
                <button
                  className="btn-primary"
                  onClick={() => handleConvertSubmit()}
                  disabled={
                    isConverting ||
                    pastGrace ||
                    (hasOutOfStock && !allowBackorder)
                  }
                >
                  {isConverting ? 'Processing...' : `Convert & Pay $${grandTotal.toFixed(2)}`}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Convert payment confirmation — fires before the actual API
          call so the cashier has to deliberately confirm payment. */}
      {showConvertConfirm && convertData && (() => {
        const { quote, check } = convertData;
        const payable =
          typeof check.payableAmount === 'number'
            ? check.payableAmount
            : parseFloat(quote.grandTotal);
        const methodLabel =
          convertPaymentMethod === 'eftpos'
            ? 'EFTPOS'
            : convertPaymentMethod === 'cash'
              ? 'Cash'
              : 'Bank Transfer';
        return (
          <div
            className="modal-backdrop-small-top"
            onClick={() => setShowConvertConfirm(false)}
          >
            <div
              className="modal-content-small max-w-sm text-center"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-lg font-bold mb-2">Has the customer paid?</h3>
              <p className="text-sm text-gray-400 mb-4">
                Confirm you've received{' '}
                <span className="font-bold text-primary-400">
                  ${payable.toFixed(2)}
                </span>{' '}
                via{' '}
                <span className="font-semibold text-gray-200 uppercase">
                  {methodLabel}
                </span>{' '}
                for quote {quote.quoteNumber}.
              </p>
              <div className="flex gap-3">
                <button
                  className="btn-secondary flex-1"
                  onClick={() => setShowConvertConfirm(false)}
                  disabled={isConverting}
                >
                  No, go back
                </button>
                <button
                  className="btn-success flex-1"
                  onClick={() => {
                    setShowConvertConfirm(false);
                    handleConvertSubmit(true);
                  }}
                  autoFocus
                  disabled={isConverting}
                >
                  Yes, convert order
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Cancel confirm */}
      {cancelConfirm && (
        <div className="modal-backdrop-top">
          <div className="modal-content">
            <h3 className="text-lg font-bold mb-2">Cancel Quote?</h3>
            <p className="text-sm text-gray-400 mb-6">
              Are you sure you want to cancel quote {cancelConfirm.quoteNumber}? This cannot be undone.
            </p>
            <div className="flex justify-end gap-3">
              <button className="btn-secondary" onClick={() => setCancelConfirm(null)}>
                Keep Quote
              </button>
              <button
                className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg"
                onClick={handleCancelQuote}
              >
                Yes, Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Print view (full invoice-style) */}
      {printingQuote && (
        <div className="modal-backdrop-top print:bg-white print:static" style={{ zIndex: 70 }}>
          <div className="modal-content bg-white text-black !p-0 print:shadow-none printable-root">
            <div className="p-8">
              {/* Store header */}
              <div className="flex justify-between items-start mb-6 border-b-2 border-gray-800 pb-4">
                <div>
                  <h1 className="text-2xl font-bold">
                    {storeSettings.store_name || 'Australian Lighting & Fans'}
                  </h1>
                  {storeSettings.store_address && (
                    <p className="text-sm text-gray-600">{storeSettings.store_address}</p>
                  )}
                  {storeSettings.store_phone && (
                    <p className="text-sm text-gray-600">Phone: {storeSettings.store_phone}</p>
                  )}
                  {storeSettings.store_email && (
                    <p className="text-sm text-gray-600">{storeSettings.store_email}</p>
                  )}
                  {storeSettings.store_abn && (
                    <p className="text-sm text-gray-600">ABN: {storeSettings.store_abn}</p>
                  )}
                </div>
                <div className="text-right">
                  <h2 className="text-xl font-bold uppercase">Quotation</h2>
                  <p className="text-sm mt-1">#{printingQuote.quoteNumber}</p>
                </div>
              </div>

              {/* Quote meta */}
              <div className="grid grid-cols-2 gap-6 mb-6 text-sm">
                <div>
                  <p className="text-gray-600 uppercase text-xs font-bold mb-1">Quote To</p>
                  {printingQuote.customer ? (
                    <>
                      <p className="font-medium">
                        {printingQuote.customer.firstName} {printingQuote.customer.lastName}
                      </p>
                      {printingQuote.customer.email && (
                        <p className="text-gray-600">{printingQuote.customer.email}</p>
                      )}
                      {printingQuote.customer.phone && (
                        <p className="text-gray-600">{printingQuote.customer.phone}</p>
                      )}
                    </>
                  ) : (
                    <p>Walk-in Customer</p>
                  )}
                </div>
                <div className="text-right">
                  <p><span className="text-gray-600">Quote Date:</span> {formatDate(printingQuote.createdAt)}</p>
                  <p><span className="text-gray-600">Valid Until:</span> {formatDate(printingQuote.expiresAt)}</p>
                  <p><span className="text-gray-600">Type:</span> {(printingQuote.buyerType || 'customer').toUpperCase()}</p>
                </div>
              </div>

              {/* Line items */}
              <table className="w-full mb-6 text-sm">
                <thead>
                  <tr className="border-b-2 border-gray-800">
                    <th className="text-left py-2">Item</th>
                    <th className="text-center py-2 w-16">Qty</th>
                    <th className="text-right py-2 w-24">Unit Price</th>
                    <th className="text-center py-2 w-16">Disc %</th>
                    <th className="text-right py-2 w-24">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {printingQuote.items?.map((item: any) => (
                    <tr key={item.id} className="border-b border-gray-200">
                      <td className="py-2">
                        <p className="font-medium">{item.name}</p>
                        <p className="text-xs text-gray-600">SKU: {item.sku}</p>
                      </td>
                      <td className="text-center py-2">{item.quantity}</td>
                      <td className="text-right py-2">${parseFloat(item.unitPrice).toFixed(2)}</td>
                      <td className="text-center py-2">{parseFloat(item.discountPercent)}%</td>
                      <td className="text-right py-2 font-medium">
                        ${parseFloat(item.rowTotal).toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Totals */}
              <div className="flex justify-end mb-6">
                <div className="w-64 text-sm">
                  <div className="flex justify-between py-1">
                    <span>Subtotal</span>
                    <span>${parseFloat(printingQuote.subtotal).toFixed(2)}</span>
                  </div>
                  {parseFloat(printingQuote.discountAmount) > 0 && (
                    <div className="flex justify-between py-1">
                      <span>Discount</span>
                      <span>-${parseFloat(printingQuote.discountAmount).toFixed(2)}</span>
                    </div>
                  )}
                  <div className="flex justify-between py-1">
                    <span>GST (10%)</span>
                    <span>${parseFloat(printingQuote.taxAmount).toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between py-2 border-t-2 border-gray-800 font-bold text-lg">
                    <span>Total</span>
                    <span>${parseFloat(printingQuote.grandTotal).toFixed(2)}</span>
                  </div>
                </div>
              </div>

              {printingQuote.notes && (
                <div className="mb-6 text-sm">
                  <p className="font-bold">Notes</p>
                  <p className="text-gray-700 whitespace-pre-wrap">{printingQuote.notes}</p>
                </div>
              )}

              {/* T&Cs */}
              <div className="border-t border-gray-300 pt-4 text-xs text-gray-600">
                <p className="font-bold mb-1">Terms &amp; Conditions</p>
                <p>All prices include GST. This quote is valid until {formatDate(printingQuote.expiresAt)}. Subject to product availability at the time of order. Prices may be adjusted downward to match current promotions.</p>
              </div>
            </div>

            <div className="flex gap-3 p-4 border-t border-gray-200 print:hidden">
              <button className="btn-secondary flex-1" onClick={() => setPrintingQuote(null)}>
                Close
              </button>
              <button
                className="btn-primary flex-1 flex items-center justify-center gap-2"
                onClick={() => window.print()}
              >
                <PrinterIcon className="h-5 w-5" />
                Print
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
