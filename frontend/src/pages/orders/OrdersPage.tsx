import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useSelector } from 'react-redux';
import toast from 'react-hot-toast';
import { ordersApi, syncApi, customersApi } from '../../services/api';
import { RootState } from '../../store';
import { buildInvoiceData } from '../../utils/orderInvoice';
import InvoiceModal from '../pos/components/InvoiceModal';
import EditOrderItemsModal from './EditOrderItemsModal';
import {
  MagnifyingGlassIcon,
  EyeIcon,
  PlusIcon,
  ArrowUturnLeftIcon,
  PrinterIcon,
  CloudArrowUpIcon,
  ArrowLeftIcon,
  BanknotesIcon,
  CheckCircleIcon,
} from '@heroicons/react/24/outline';

interface Order {
  id: number;
  orderNumber: string;
  status: string;
  paymentStatus: string;
  grandTotal: number;
  customer: { id: number; firstName: string; lastName: string; isTrade?: boolean } | null;
  user: { id: number; firstName: string; lastName: string };
  itemCount: number;
  createdAt: string;
  source?: 'pos' | 'magento';
  orderType?: 'standard' | 'layby';
  laybyExpiresAt?: string | null;
  hasBackorderItems?: boolean;
  syncStatus?: 'pending' | 'synced' | 'failed';
  syncError?: string | null;
  magentoOrderId?: string | null;
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

// Combined filter options for the Orders filter dropdown
type FilterOption =
  | 'all'
  | 'pos'
  | 'magento'
  | 'layby'
  | 'complete'
  | 'pending'
  | 'layby_active'
  | 'layby_expired'
  | 'backorder_pending'
  | 'refund_in_process'
  | 'refunded'
  | 'cancelled';

const FILTER_OPTIONS: { value: FilterOption; label: string }[] = [
  { value: 'all', label: 'All Orders' },
  { value: 'pos', label: 'POS Orders' },
  { value: 'magento', label: 'Magento Orders' },
  { value: 'layby', label: 'Lay Bys (all)' },
  { value: 'layby_active', label: 'Lay By — Active' },
  { value: 'layby_expired', label: 'Lay By — Expired' },
  { value: 'backorder_pending', label: 'Backorder Pending' },
  { value: 'complete', label: 'Completed' },
  { value: 'pending', label: 'Pending' },
  { value: 'refund_in_process', label: 'Partial Refund' },
  { value: 'refunded', label: 'Refunded' },
  { value: 'cancelled', label: 'Cancelled' },
];

const REFUND_REASONS: { value: string; label: string }[] = [
  { value: 'damaged', label: 'Damaged' },
  { value: 'faulty_product', label: 'Faulty Product' },
  { value: 'wrong_item', label: 'Wrong Item' },
  { value: 'customer_changed_mind', label: 'Customer Changed Mind' },
  { value: 'pricing_error', label: 'Pricing Error' },
  { value: 'other', label: 'Other' },
];

const NON_RESTOCKABLE_REASONS = new Set(['damaged', 'faulty_product']);

interface RefundSelection {
  orderItemId: number;
  name: string;
  sku: string;
  unitPrice: number;
  originalQty: number;
  remainingQty: number;
  selected: boolean;
  quantity: number;
  restock: boolean;
}

export default function OrdersPage() {
  const navigate = useNavigate();
  const { user } = useSelector((state: RootState) => state.auth);
  const canRefund =
    user?.role.name === 'admin' ||
    user?.role.name === 'manager' ||
    user?.role.name === 'sales_staff';

  const [orders, setOrders] = useState<Order[]>([]);
  const [pagination, setPagination] = useState<Pagination>({ page: 1, limit: 20, total: 0, totalPages: 0 });
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<FilterOption>('all');
  const [selectedOrder, setSelectedOrder] = useState<any>(null);
  // "Edit Items" modal target — clone selectedOrder into this state to
  // open it. Closed on cancel or after a successful save (which also
  // refreshes selectedOrder).
  const [editItemsOrder, setEditItemsOrder] = useState<any>(null);
  const [invoiceData, setInvoiceData] = useState<any>(null);
  // Order-notes edit-in-place: null = not editing, string = current
  // draft. Committing sends a PATCH and refreshes the selected order.
  const [notesDraft, setNotesDraft] = useState<string | null>(null);
  const [savingNotes, setSavingNotes] = useState(false);

  const saveOrderNotes = async () => {
    if (!selectedOrder || notesDraft === null) return;
    setSavingNotes(true);
    try {
      await ordersApi.updateNotes(selectedOrder.id, notesDraft.trim() || null);
      const fresh = await ordersApi.getOrder(selectedOrder.id);
      setSelectedOrder({
        ...fresh.data.data.order,
        refunds: selectedOrder?.refunds || [],
      });
      setNotesDraft(null);
      toast.success('Notes saved');
    } catch {
      toast.error('Failed to save notes');
    } finally {
      setSavingNotes(false);
    }
  };

  const printInvoice = async (orderId: number) => {
    try {
      const r = await ordersApi.getOrder(orderId);
      const o = r.data?.data?.order;
      if (!o) {
        toast.error('Could not load order for printing');
        return;
      }
      setInvoiceData(buildInvoiceData(o));
    } catch {
      toast.error('Could not load order for printing');
    }
  };

  // Refund modal state
  const [refundOrder, setRefundOrder] = useState<any>(null);

  // Link-customer flow (for walk-in orders that need a customer before refund)
  const [linkOrder, setLinkOrder] = useState<Order | null>(null);
  const [linkSearch, setLinkSearch] = useState('');
  const [linkResults, setLinkResults] = useState<any[]>([]);
  const [linkLoading, setLinkLoading] = useState(false);
  const [isLinking, setIsLinking] = useState(false);
  const [refundItems, setRefundItems] = useState<RefundSelection[]>([]);
  const [refundReason, setRefundReason] = useState<string>('damaged');
  const [refundReasonText, setRefundReasonText] = useState('');
  const [refundAsCash, setRefundAsCash] = useState(false);
  const [refundRestockingFee, setRefundRestockingFee] = useState(false);
  const [isProcessingRefund, setIsProcessingRefund] = useState(false);
  const [completedRefund, setCompletedRefund] = useState<any>(null);

  // Layby payment modal
  const [laybyPayOrder, setLaybyPayOrder] = useState<Order | null>(null);
  const [laybyBalance, setLaybyBalance] = useState<{ grandTotal: number; paid: number; balance: number } | null>(null);
  const [laybyPayAmount, setLaybyPayAmount] = useState('');
  const [laybyPayMethod, setLaybyPayMethod] = useState<'cash' | 'eftpos' | 'bank_transfer' | 'store_credit'>('eftpos');
  const [laybyPayRef, setLaybyPayRef] = useState('');
  // Printable receipt for a lay-by instalment, shown after the payment
  // is recorded.
  const [laybyReceipt, setLaybyReceipt] = useState<any>(null);
  const [isTakingLaybyPayment, setIsTakingLaybyPayment] = useState(false);

  const canManage =
    user?.role.name === 'admin' || user?.role.name === 'manager';

  useEffect(() => {
    fetchOrders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pagination.page, search, filter]);

  const fetchOrders = async () => {
    try {
      setIsLoading(true);
      // Map the combined filter to the actual query params
      const params: any = {
        search: search || undefined,
        page: pagination.page,
        limit: 20,
      };
      if (filter === 'pos' || filter === 'magento') {
        params.source = filter;
      } else if (filter === 'layby') {
        params.type = 'layby';
      } else if (filter !== 'all') {
        params.status = filter;
      }

      const response = await ordersApi.getOrders(params);
      setOrders(response.data.data.orders);
      setPagination(response.data.data.pagination);
    } catch (error) {
      console.error('Failed to fetch orders:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const viewOrder = async (id: number) => {
    try {
      const [orderRes, refundsRes] = await Promise.all([
        ordersApi.getOrder(id),
        ordersApi.getRefunds(id),
      ]);
      setSelectedOrder({
        ...orderRes.data.data.order,
        refunds: refundsRes.data.data.refunds,
      });
    } catch (error) {
      console.error('Failed to fetch order:', error);
    }
  };

  const openRefundModal = async (order: Order) => {
    // Walk-ins can now be refunded as cash without linking a customer.
    // Cashier can still opt to link a customer inside the modal to issue
    // store credit instead (via the Link Customer link we show there).
    try {
      const [orderRes, refundsRes] = await Promise.all([
        ordersApi.getOrder(order.id),
        ordersApi.getRefunds(order.id),
      ]);
      const fullOrder = orderRes.data.data.order;
      const existingRefunds = refundsRes.data.data.refunds || [];

      // Map of already-refunded qty per order_item
      const refundedMap = new Map<number, number>();
      for (const r of existingRefunds) {
        for (const ri of r.items) {
          refundedMap.set(
            ri.orderItemId,
            (refundedMap.get(ri.orderItemId) || 0) + ri.quantity,
          );
        }
      }

      const selections: RefundSelection[] = (fullOrder.items || []).map((item: any) => {
        const refundedQty = refundedMap.get(item.id) || 0;
        const remaining = item.quantity - refundedQty;
        return {
          orderItemId: item.id,
          name: item.name,
          sku: item.sku,
          unitPrice:
            item.quantity > 0
              ? parseFloat(item.rowTotal) / item.quantity
              : parseFloat(item.unitPrice),
          originalQty: item.quantity,
          remainingQty: remaining,
          selected: false,
          quantity: remaining > 0 ? 1 : 0,
          restock: true,
        };
      });

      setRefundOrder(fullOrder);
      setRefundItems(selections);
      setRefundReason('damaged');
      setRefundReasonText('');
      // Walk-ins with no customer default to cash (can't issue credit to no-one)
      setRefundAsCash(!fullOrder.customer);
      setRefundRestockingFee(false);
      // Default restock off for damaged/faulty on open
      setRefundItems((prev) =>
        prev.map((it) => ({ ...it, restock: !NON_RESTOCKABLE_REASONS.has('damaged') })),
      );
    } catch (error) {
      toast.error('Failed to load order for refund');
    }
  };

  const updateRefundItem = (idx: number, patch: Partial<RefundSelection>) => {
    setRefundItems((prev) =>
      prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)),
    );
  };

  // When reason changes, flip restock defaults (but allow manual override to persist only if user touched it)
  const handleReasonChange = (newReason: string) => {
    setRefundReason(newReason);
    const defaultRestock = !NON_RESTOCKABLE_REASONS.has(newReason);
    setRefundItems((prev) => prev.map((it) => ({ ...it, restock: defaultRestock })));
  };

  const refundTotal = refundItems
    .filter((i) => i.selected && i.quantity > 0)
    .reduce((sum, i) => sum + i.unitPrice * i.quantity, 0);

  const processRefund = async (asExchange: boolean = false) => {
    const items = refundItems
      .filter((i) => i.selected && i.quantity > 0)
      .map((i) => ({
        orderItemId: i.orderItemId,
        quantity: i.quantity,
        restock: i.restock,
      }));

    if (items.length === 0) {
      toast.error('Select at least one item to refund');
      return;
    }
    if (refundReason === 'other' && !refundReasonText.trim()) {
      toast.error('Please enter a reason');
      return;
    }
    if (refundReasonText.length > 500) {
      toast.error('Reason text must be 500 characters or fewer');
      return;
    }
    // An exchange returns the item(s) to store credit, then sends the
    // cashier to the POS to ring the replacement — so it needs a linked
    // customer to hold the credit.
    if (asExchange && !refundOrder.customer) {
      toast.error('Link a customer first — an exchange issues store credit');
      return;
    }

    setIsProcessingRefund(true);
    try {
      const res = await ordersApi.createRefund(refundOrder.id, {
        reason: refundReason,
        reasonText:
          (asExchange ? '[EXCHANGE] ' : '') + (refundReasonText.trim() || ''),
        items,
        // Exchanges always go to store credit (used against the new sale).
        asCash: asExchange ? false : refundAsCash || !refundOrder.customer,
        applyRestockingFee: refundRestockingFee,
      });
      if (asExchange) {
        const ex = refundOrder;
        const cust = ex.customer;
        setRefundOrder(null);
        fetchOrders();
        toast.success('Items returned to store credit — ring the replacement');
        navigate('/pos', {
          state: {
            preselectCustomer: cust
              ? {
                  id: cust.id,
                  name: `${cust.firstName} ${cust.lastName || ''}`.trim(),
                  isTrade: !!cust.isTrade,
                }
              : undefined,
            exchangeFromOrder: { id: ex.id, orderNumber: ex.orderNumber },
          },
        });
        return;
      }
      toast.success('Refund processed successfully');
      setCompletedRefund({
        refund: res.data.data.refund,
        order: refundOrder,
        itemsByOrderItemId: Object.fromEntries(
          refundItems.map((i) => [i.orderItemId, i]),
        ),
      });
      setRefundOrder(null);
      fetchOrders();
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Refund failed');
    } finally {
      setIsProcessingRefund(false);
    }
  };

  const formatDate = (date: string) => {
    return new Date(date).toLocaleDateString('en-AU', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getStatusBadge = (status: string, hasExchange = false) => {
    const colors: Record<string, string> = {
      complete: 'bg-green-600',
      pending: 'bg-yellow-600',
      cancelled: 'bg-red-600',
      refunded: 'bg-purple-600',
      refund_in_process: 'bg-orange-600',
      layby_active: 'bg-amber-600',
      layby_expired: 'bg-red-700',
      backorder_pending: 'bg-cyan-700',
    };
    const labels: Record<string, string> = {
      refund_in_process: 'PARTIAL REFUND',
      layby_active: 'LAY BY',
      layby_expired: 'LAY BY EXPIRED',
      backorder_pending: 'BACKORDER',
    };
    // If the order was exchanged (has a replacement pointing at it), the
    // badge reads EXCHANGED instead of REFUNDED / PARTIAL REFUND — same
    // color scale (cyan) so it's visually distinct from a plain refund.
    if (hasExchange && (status === 'refunded' || status === 'refund_in_process')) {
      return (
        <span className="px-2 py-1 rounded text-xs font-medium whitespace-nowrap bg-cyan-600">
          EXCHANGED
        </span>
      );
    }
    return (
      <span className={`px-2 py-1 rounded text-xs font-medium whitespace-nowrap ${colors[status] || 'bg-gray-600'}`}>
        {labels[status] || status.toUpperCase()}
      </span>
    );
  };

  // Debounced customer search for the Link Customer flow
  useEffect(() => {
    if (!linkOrder) return;
    if (linkSearch.trim().length < 2) {
      setLinkResults([]);
      return;
    }
    setLinkLoading(true);
    const timer = setTimeout(async () => {
      try {
        const res = await customersApi.getCustomers({ search: linkSearch.trim(), limit: 10 });
        setLinkResults(res.data.data?.customers || []);
      } catch {
        setLinkResults([]);
      } finally {
        setLinkLoading(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [linkSearch, linkOrder]);

  const handleLinkPick = async (customer: any) => {
    if (!linkOrder) return;
    setIsLinking(true);
    try {
      await ordersApi.linkCustomer(linkOrder.id, customer.id);
      toast.success(`Linked ${customer.firstName} ${customer.lastName} to ${linkOrder.orderNumber}`);
      // Refresh orders and continue into the refund modal
      await fetchOrders();
      const fullOrder: Order = {
        ...linkOrder,
        customer: {
          id: customer.id,
          firstName: customer.firstName,
          lastName: customer.lastName,
        },
      };
      setLinkOrder(null);
      setLinkSearch('');
      setLinkResults([]);
      // Jump straight into the refund flow for the now-linked order
      openRefundModal(fullOrder);
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Failed to link customer');
    } finally {
      setIsLinking(false);
    }
  };

  const handleRetryPush = async (orderId: number) => {
    try {
      const res = await syncApi.pushOrderToMagento(orderId);
      if (res.data.success) {
        toast.success(res.data.message || 'Pushed to Magento');
        fetchOrders();
      } else {
        toast.error(res.data.message || 'Push failed');
      }
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Push failed');
    }
  };

  const isRefundable = (status: string) =>
    status !== 'refunded' && status !== 'cancelled';

  const openLaybyPay = async (order: Order) => {
    try {
      // Pull the full order alongside the balance so the payment screen
      // can show what's actually on lay-by, not just the numbers.
      const [balRes, orderRes] = await Promise.all([
        ordersApi.getLaybyBalance(order.id),
        ordersApi.getOrder(order.id),
      ]);
      const b = balRes.data.data as { grandTotal: number; paid: number; balance: number };
      setLaybyBalance(b);
      setLaybyPayOrder(orderRes.data?.data?.order || order);
      setLaybyPayAmount(b.balance.toFixed(2));
      setLaybyPayMethod('eftpos');
      setLaybyPayRef('');
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Failed to load Lay By balance');
    }
  };

  const handleTakeLaybyPayment = async () => {
    if (!laybyPayOrder) return;
    const amount = parseFloat(laybyPayAmount);
    if (!amount || amount <= 0) {
      toast.error('Enter a payment amount');
      return;
    }
    setIsTakingLaybyPayment(true);
    try {
      const res = await ordersApi.takeLaybyPayment(laybyPayOrder.id, {
        amount,
        method: laybyPayMethod,
        reference: laybyPayRef.trim() || undefined,
      });
      const newStatus = res.data?.data?.order?.status;
      if (newStatus === 'complete') {
        toast.success(`Lay By ${laybyPayOrder.orderNumber} fully paid — marked complete`);
      } else {
        toast.success(`Payment of $${amount.toFixed(2)} recorded`);
      }
      // Hand the cashier a printable receipt for the instalment rather
      // than just closing — Sally: "Need a print button to print the
      // payment, and invoice to show the part payment".
      const priorPaid = laybyBalance?.paid ?? 0;
      const total = laybyBalance?.grandTotal ?? 0;
      setLaybyReceipt({
        order: laybyPayOrder,
        amount,
        method: laybyPayMethod,
        reference: laybyPayRef.trim() || null,
        paidToDate: Math.round((priorPaid + amount) * 100) / 100,
        balanceAfter: Math.max(
          0,
          Math.round((total - priorPaid - amount) * 100) / 100,
        ),
        grandTotal: total,
        isFinal: newStatus === 'complete',
        date: new Date().toISOString(),
      });
      setLaybyPayOrder(null);
      fetchOrders();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Failed to record payment');
    } finally {
      setIsTakingLaybyPayment(false);
    }
  };

  const handleCancelLayby = async (order: Order) => {
    if (
      !window.confirm(
        `Cancel layby ${order.orderNumber}? Stock will be released. You'll be asked whether to refund paid amounts as store credit.`,
      )
    )
      return;
    const refund = window.confirm(
      'Refund what the customer has already paid as store credit? OK = refund, Cancel = forfeit deposit.',
    );
    try {
      await ordersApi.cancelLayby(order.id, { refundAsStoreCredit: refund });
      toast.success(`Lay By ${order.orderNumber} cancelled`);
      fetchOrders();
      setSelectedOrder(null);
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Failed to cancel Lay By');
    }
  };

  const handleFulfilBackorder = async (order: any, itemIds: number[]) => {
    if (itemIds.length === 0) {
      toast.error('Select items to mark as received');
      return;
    }
    try {
      const res = await ordersApi.fulfillBackorder(order.id, itemIds);
      const newStatus = res.data?.data?.order?.status;
      if (newStatus === 'complete') {
        toast.success(`Order ${order.orderNumber} fully fulfilled`);
      } else {
        toast.success(`${itemIds.length} item(s) marked as received`);
      }
      // Refresh detail and list
      const fresh = await ordersApi.getOrder(order.id);
      setSelectedOrder({ ...fresh.data.data.order, refunds: selectedOrder?.refunds || [] });
      fetchOrders();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Failed to fulfil items');
    }
  };

  return (
    <div className="h-full p-6 overflow-auto">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Orders</h1>
        <div className="flex items-center gap-4">
          <span className="text-sm text-gray-400">Total: {pagination.total} orders</span>
          <Link to="/pos" className="btn-primary flex items-center gap-2">
            <PlusIcon className="h-5 w-5" />
            Create Order
          </Link>
        </div>
      </div>

      {/* Search + Filter */}
      <div className="flex gap-3 mb-4">
        <div className="relative flex-1">
          <MagnifyingGlassIcon className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
          <input
            type="text"
            placeholder="Search by order number, customer name, phone, or email..."
            className="input pl-12"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select
          className="input w-56"
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value as FilterOption);
            setPagination((p) => ({ ...p, page: 1 }));
          }}
        >
          {FILTER_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {/* Orders Table */}
      <div className="card overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-gray-400">Loading orders...</div>
        ) : orders.length === 0 ? (
          <div className="p-8 text-center text-gray-400">No orders found</div>
        ) : (
          <table className="w-full">
            <thead className="bg-pos-accent">
              <tr>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-300">Order #</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-300">Customer</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-300">Items</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-300">Total</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-300">Status</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-300">Date</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-300">Cashier</th>
                <th className="px-4 py-3 text-center text-sm font-medium text-gray-300">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700">
              {orders.map((order) => (
                <tr
                  key={order.id}
                  className={`hover:bg-pos-accent/50 ${
                    order.customer?.isTrade ? 'bg-orange-500/5 border-l-2 border-orange-500' : ''
                  }`}
                >
                  <td className="px-4 py-3 font-medium">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span>{order.orderNumber}</span>
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase ${
                          order.source === 'magento'
                            ? 'bg-purple-600/30 text-purple-300'
                            : 'bg-blue-600/30 text-blue-300'
                        }`}
                      >
                        {order.source === 'magento' ? 'M2' : 'POS'}
                      </span>
                      {order.source === 'pos' && order.syncStatus === 'synced' && (
                        <span
                          className="px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase bg-green-600/30 text-green-300"
                          title={`Pushed to Magento as #${order.magentoOrderId ?? '?'}`}
                        >
                          M2 ✓
                        </span>
                      )}
                      {order.source === 'pos' && order.syncStatus === 'pending' && (
                        <span
                          className="px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase bg-yellow-600/30 text-yellow-300"
                          title="Waiting to push to Magento"
                        >
                          M2 ⋯
                        </span>
                      )}
                      {order.source === 'pos' && order.syncStatus === 'failed' && (
                        <span
                          className="px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase bg-red-600/30 text-red-300"
                          title={order.syncError || 'Push to Magento failed'}
                        >
                          M2 ✗
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {order.customer ? (
                      <span className="flex items-center gap-2">
                        <span>{order.customer.firstName} {order.customer.lastName}</span>
                        {order.customer.isTrade && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase bg-orange-600/30 text-orange-300 border border-orange-500/40">
                            TRADE
                          </span>
                        )}
                      </span>
                    ) : (order as any).customerNameSnapshot ? (
                      <span className="flex items-center gap-2">
                        <span>{(order as any).customerNameSnapshot}</span>
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase bg-gray-600/40 text-gray-300 border border-gray-500/40">
                          WALK-IN
                        </span>
                      </span>
                    ) : (
                      'Walk-in'
                    )}
                  </td>
                  <td className="px-4 py-3">{order.itemCount}</td>
                  <td className="px-4 py-3 font-medium">${order.grandTotal.toFixed(2)}</td>
                  <td className="px-4 py-3">
                    {getStatusBadge(
                      order.status,
                      !!(order as any).hasExchange,
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-400">{formatDate(order.createdAt)}</td>
                  <td className="px-4 py-3">{order.user.firstName}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-center gap-1">
                      <button
                        onClick={() => viewOrder(order.id)}
                        className="p-2 hover:bg-pos-accent rounded"
                        title="View Order"
                      >
                        <EyeIcon className="h-5 w-5" />
                      </button>
                      <button
                        onClick={() => printInvoice(order.id)}
                        className="p-2 hover:bg-pos-accent rounded text-primary-400"
                        title="Print Invoice"
                      >
                        <PrinterIcon className="h-5 w-5" />
                      </button>
                      {(order.status === 'layby_active' ||
                        order.status === 'layby_expired') && (
                        <button
                          onClick={() => openLaybyPay(order)}
                          className="p-2 hover:bg-amber-500/20 text-amber-300 rounded"
                          title="Take Lay By payment"
                        >
                          <BanknotesIcon className="h-5 w-5" />
                        </button>
                      )}
                      {canRefund && isRefundable(order.status) && (
                        <button
                          onClick={() => openRefundModal(order)}
                          className="p-2 hover:bg-orange-500/20 text-orange-400 rounded"
                          title="Refund"
                        >
                          <ArrowUturnLeftIcon className="h-5 w-5" />
                        </button>
                      )}
                      {canRefund &&
                        order.source === 'pos' &&
                        (order.syncStatus === 'failed' || order.syncStatus === 'pending') && (
                          <button
                            onClick={() => handleRetryPush(order.id)}
                            className="p-2 hover:bg-blue-500/20 text-blue-300 rounded"
                            title={
                              order.syncStatus === 'failed'
                                ? `Retry Magento push: ${order.syncError || ''}`
                                : 'Push to Magento now'
                            }
                          >
                            <CloudArrowUpIcon className="h-5 w-5" />
                          </button>
                        )}
                    </div>
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

      {/* Invoice print/preview */}
      {invoiceData && (
        <InvoiceModal invoice={invoiceData} onClose={() => setInvoiceData(null)} />
      )}

      {/* Edit Items — layered above the order-detail drawer. After a
          successful save we refetch the order so the drawer reflects
          the new items + total. */}
      {editItemsOrder && (
        <EditOrderItemsModal
          order={editItemsOrder}
          onClose={() => setEditItemsOrder(null)}
          onSaved={async () => {
            setEditItemsOrder(null);
            try {
              const fresh = await ordersApi.getOrder(editItemsOrder.id);
              setSelectedOrder({
                ...fresh.data.data.order,
                refunds: selectedOrder?.refunds || [],
              });
            } catch {
              // ignored — user can close + reopen the drawer if refresh fails
            }
            fetchOrders();
          }}
        />
      )}

      {/* Order Detail Modal */}
      {selectedOrder && (
        <div className="modal-backdrop">
          <div className="modal-content">
            <div className="max-w-4xl mx-auto">
            <div className="flex justify-between items-start mb-4">
              <button onClick={() => setSelectedOrder(null)} className="modal-back-btn">
                <ArrowLeftIcon className="h-5 w-5" /> Back
              </button>
              <div className="flex items-center gap-3">
                {/* Edit Items — only when the order is still open.
                    Complete/refunded/cancelled orders have a frozen
                    item list (server enforces the same rule). */}
                {['pending', 'processing', 'backorder_pending', 'layby_active', 'layby_expired'].includes(
                  selectedOrder.status,
                ) && (
                  <button
                    className="btn-secondary flex items-center gap-2 text-sm"
                    onClick={() => setEditItemsOrder(selectedOrder)}
                    title="Add/remove products, fix quantities or prices while the order is open"
                  >
                    Edit Items
                  </button>
                )}
                <button
                  className="btn-secondary flex items-center gap-2 text-sm"
                  onClick={() => {
                    const id = selectedOrder.id;
                    setSelectedOrder(null);
                    printInvoice(id);
                  }}
                >
                  <PrinterIcon className="h-4 w-4" /> Print Invoice
                </button>
                <div className="text-right">
                  <h2 className="text-xl font-bold">{selectedOrder.orderNumber}</h2>
                  <p className="text-sm text-gray-400">{formatDate(selectedOrder.createdAt)}</p>
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-gray-400">Customer</p>
                  <p>
                    {selectedOrder.customer
                      ? `${selectedOrder.customer.firstName} ${selectedOrder.customer.lastName}`
                      : 'Walk-in'}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-gray-400">Cashier</p>
                  <p>
                    {selectedOrder.user?.firstName} {selectedOrder.user?.lastName}
                  </p>
                </div>
              </div>

              <div>
                <p className="text-sm text-gray-400 mb-2">Items</p>
                <div className="bg-pos-dark rounded p-3 space-y-2">
                  {selectedOrder.items?.map((item: any) => (
                    <div key={item.id} className="flex justify-between items-center gap-2">
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        <span className="truncate">
                          {item.quantity}x {item.name}
                        </span>
                        {item.isBackorder && !item.backorderFulfilledAt && (
                          <span
                            className="px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase bg-cyan-600/30 text-cyan-300 whitespace-nowrap"
                            title="Ordering from supplier"
                          >
                            Backorder · Ordering from supplier
                          </span>
                        )}
                        {item.isBackorder && item.backorderFulfilledAt && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase bg-green-600/30 text-green-300 whitespace-nowrap">
                            Fulfilled
                          </span>
                        )}
                      </div>
                      <span className="whitespace-nowrap">${parseFloat(item.rowTotal).toFixed(2)}</span>
                      {canManage &&
                        item.isBackorder &&
                        !item.backorderFulfilledAt && (
                          <button
                            onClick={() => handleFulfilBackorder(selectedOrder, [item.id])}
                            className="p-1.5 hover:bg-green-500/20 text-green-400 rounded"
                            title="Mark this backorder item as received"
                          >
                            <CheckCircleIcon className="h-4 w-4" />
                          </button>
                        )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Layby actions */}
              {(selectedOrder.status === 'layby_active' ||
                selectedOrder.status === 'layby_expired') && (
                <div className="border-t border-gray-700 pt-4 space-y-2">
                  <p className="text-sm font-medium text-amber-300">
                    Lay By
                    {selectedOrder.laybyExpiresAt && (
                      <span className="text-xs text-gray-400 ml-2">
                        Expires {formatDate(selectedOrder.laybyExpiresAt)}
                      </span>
                    )}
                  </p>
                  <div className="flex gap-2">
                    <button
                      className="btn-primary bg-amber-600 hover:bg-amber-700 flex items-center gap-2"
                      onClick={() => openLaybyPay(selectedOrder)}
                    >
                      <BanknotesIcon className="h-4 w-4" /> Take Payment
                    </button>
                    {canManage && (
                      <button
                        className="btn-secondary"
                        onClick={() => handleCancelLayby(selectedOrder)}
                      >
                        Cancel Lay By
                      </button>
                    )}
                  </div>
                </div>
              )}

              <div className="border-t border-gray-700 pt-4">
                <div className="flex justify-between text-sm">
                  <span>Subtotal</span>
                  <span>${parseFloat(selectedOrder.subtotal).toFixed(2)}</span>
                </div>
                {parseFloat(selectedOrder.discountAmount) > 0 && (
                  <div className="flex justify-between text-sm text-green-400">
                    <span>Discount</span>
                    <span>-${parseFloat(selectedOrder.discountAmount).toFixed(2)}</span>
                  </div>
                )}
                <div className="flex justify-between text-sm">
                  <span>Tax</span>
                  <span>${parseFloat(selectedOrder.taxAmount).toFixed(2)}</span>
                </div>
                <div className="flex justify-between font-bold text-lg mt-2">
                  <span>Total</span>
                  <span>${parseFloat(selectedOrder.grandTotal).toFixed(2)}</span>
                </div>
                {/* Refund total + net paid — only shown when at least
                    one refund exists so a normal order still reads
                    cleanly. Refund reasonText carries the 20% restock
                    fee retained amount if any, but here we only need
                    the sum of cash refunded to compute net paid. */}
                {(selectedOrder.refunds || []).length > 0 && (() => {
                  const totalRefunded = (selectedOrder.refunds || []).reduce(
                    (s: number, r: any) => s + Number(r.refundAmount || 0),
                    0,
                  );
                  const netPaid =
                    Math.round(
                      (parseFloat(selectedOrder.grandTotal) - totalRefunded) * 100,
                    ) / 100;
                  return (
                    <div className="mt-2 pt-2 border-t border-gray-700 space-y-1">
                      <div className="flex justify-between text-sm text-orange-300">
                        <span>Refunded</span>
                        <span>-${totalRefunded.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between font-semibold text-emerald-300">
                        <span>Net Paid</span>
                        <span>${netPaid.toFixed(2)}</span>
                      </div>
                    </div>
                  );
                })()}
              </div>

              {/* Free-form staff notes (persist on order.notes). Cashiers
                  use this to jot follow-ups: pickup times, ETAs, restock
                  status. Edit-in-place; save button appears once a draft
                  is opened. */}
              <div className="border-t border-gray-700 pt-4">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm text-gray-400">Notes</p>
                  {notesDraft === null && (
                    <button
                      onClick={() =>
                        setNotesDraft(selectedOrder.notes || '')
                      }
                      className="text-xs text-primary-400 hover:text-primary-300"
                    >
                      {selectedOrder.notes ? 'Edit' : 'Add note'}
                    </button>
                  )}
                </div>
                {notesDraft === null ? (
                  <p className="text-sm text-gray-300 whitespace-pre-wrap">
                    {selectedOrder.notes || (
                      <span className="text-gray-500 italic">
                        No notes on this order.
                      </span>
                    )}
                  </p>
                ) : (
                  <div>
                    <textarea
                      value={notesDraft}
                      onChange={(e) => setNotesDraft(e.target.value)}
                      className="input w-full text-sm"
                      rows={3}
                      placeholder="Follow-up context, pickup times, supplier ETA…"
                      autoFocus
                    />
                    <div className="flex justify-end gap-2 mt-2">
                      <button
                        onClick={() => setNotesDraft(null)}
                        className="btn-secondary text-xs"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={saveOrderNotes}
                        disabled={savingNotes}
                        className="btn-primary text-xs disabled:opacity-50"
                      >
                        {savingNotes ? 'Saving…' : 'Save'}
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Order history timeline — the purchase plus every refund
                  over time, so staff can see what's happened across
                  repeat visits (Sally: customer refunds, comes back, etc). */}
              <div className="border-t border-gray-700 pt-4">
                <p className="text-sm text-gray-400 mb-3">Order History</p>
                <div className="relative pl-5 space-y-3">
                  {/* vertical line */}
                  <div className="absolute left-1.5 top-1 bottom-1 w-px bg-gray-700" />

                  {/* Exchange cross-links — expanded to show the items
                      that were swapped, not just the linked order
                      numbers. "Original had X, exchanged for Y" is the
                      question staff want answered when they open an
                      exchanged order. */}
                  {selectedOrder.exchangedToOrders?.map((e: any) => (
                    <div key={`to-${e.id}`} className="relative">
                      <div className="absolute -left-[14px] top-1.5 h-2.5 w-2.5 rounded-full bg-cyan-400 ring-2 ring-pos-card" />
                      <div className="bg-cyan-500/10 border border-cyan-500/30 rounded p-3 text-sm text-cyan-200">
                        <div className="font-semibold mb-1">
                          Exchanged for {e.orderNumber}
                        </div>
                        {e.items && e.items.length > 0 && (
                          <ul className="text-xs space-y-0.5 text-cyan-100">
                            {e.items.map((it: any) => (
                              <li key={it.id}>
                                {it.quantity}× {it.name}
                                <span className="text-cyan-300/70">
                                  {' '}
                                  · {it.sku} · ${Number(it.unitPrice).toFixed(2)}
                                </span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </div>
                  ))}
                  {selectedOrder.exchangeFromOrder && (
                    <div className="relative">
                      <div className="absolute -left-[14px] top-1.5 h-2.5 w-2.5 rounded-full bg-cyan-400 ring-2 ring-pos-card" />
                      <div className="bg-cyan-500/10 border border-cyan-500/30 rounded p-3 text-sm text-cyan-200">
                        <div className="font-semibold mb-1">
                          Replacement for {selectedOrder.exchangeFromOrder.orderNumber}
                        </div>
                        {selectedOrder.exchangeFromOrder.items &&
                          selectedOrder.exchangeFromOrder.items.length > 0 && (
                            <>
                              <div className="text-xs mb-1 text-cyan-300/80">
                                Returned:
                              </div>
                              <ul className="text-xs space-y-0.5 text-cyan-100">
                                {selectedOrder.exchangeFromOrder.items.map(
                                  (it: any) => (
                                    <li key={it.id}>
                                      {it.quantity}× {it.name}
                                      <span className="text-cyan-300/70">
                                        {' '}
                                        · {it.sku} · $
                                        {Number(it.unitPrice).toFixed(2)}
                                      </span>
                                    </li>
                                  ),
                                )}
                              </ul>
                            </>
                          )}
                      </div>
                    </div>
                  )}

                  {/* Refund events (newest first) */}
                  {(selectedOrder.refunds || []).map((r: any) => {
                    const tags: string[] = [];
                    const isCash = /\[CASH REFUND\]/i.test(r.reasonText || '');
                    tags.push(isCash ? 'Cash refund' : 'Store credit');
                    const restockMatch = (r.reasonText || '').match(/\[20% RESTOCK FEE: \$([\d.]+) retained\]/i);
                    if (restockMatch) tags.push(`20% restock fee $${restockMatch[1]} kept`);
                    // Strip the bracketed tags from the human reason text.
                    const cleanReason = (r.reasonText || '')
                      .replace(/\[[^\]]*\]/g, '')
                      .trim();
                    return (
                      <div key={r.id} className="relative">
                        <div className="absolute -left-[14px] top-1.5 h-2.5 w-2.5 rounded-full bg-orange-400 ring-2 ring-pos-card" />
                        <div className="bg-orange-500/10 border border-orange-500/30 rounded p-3 text-sm">
                          <div className="flex justify-between mb-1">
                            <span className="font-medium text-orange-300">
                              {r.isFullRefund ? 'Full Refund' : 'Partial Refund'} — ${r.refundAmount.toFixed(2)}
                            </span>
                            <span className="text-gray-400">{formatDate(r.createdAt)}</span>
                          </div>
                          <div className="flex flex-wrap gap-1 mb-1">
                            {tags.map((t) => (
                              <span key={t} className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-orange-600/30 text-orange-200">
                                {t}
                              </span>
                            ))}
                          </div>
                          {/* Exactly what came back, so a partial refund
                              is readable without opening the receipt. */}
                          {(r.items || []).length > 0 && (
                            <ul className="mb-2 mt-1 space-y-0.5">
                              {r.items.map((ri: any) => (
                                <li
                                  key={ri.id}
                                  className="flex justify-between text-xs text-gray-300"
                                >
                                  <span>
                                    {ri.quantity}
                                    {ri.originalQuantity
                                      ? ` of ${ri.originalQuantity}`
                                      : ''}{' '}
                                    × {ri.name || `Item #${ri.orderItemId}`}
                                    {ri.sku ? (
                                      <span className="text-gray-500 font-mono">
                                        {' '}
                                        {ri.sku}
                                      </span>
                                    ) : null}
                                    {ri.restock ? (
                                      <span className="text-gray-500">
                                        {' '}
                                        · restocked
                                      </span>
                                    ) : null}
                                  </span>
                                  <span className="font-medium">
                                    ${Number(ri.amount).toFixed(2)}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          )}
                          <div className="text-xs text-gray-400">
                            Reason: {REFUND_REASONS.find((x) => x.value === r.reason)?.label || r.reason}
                            {cleanReason ? ` — "${cleanReason}"` : ''}
                          </div>
                          {r.user && (
                            <div className="text-xs text-gray-500 mt-1">
                              Processed by {r.user.firstName} {r.user.lastName}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}

                  {/* Order placed (oldest, at the bottom) */}
                  <div className="relative">
                    <div className="absolute -left-[14px] top-1.5 h-2.5 w-2.5 rounded-full bg-green-400 ring-2 ring-pos-card" />
                    <div className="bg-pos-dark rounded p-3 text-sm">
                      <div className="flex justify-between">
                        <span className="font-medium text-green-300">
                          Order placed — ${parseFloat(selectedOrder.grandTotal).toFixed(2)}
                        </span>
                        <span className="text-gray-400">{formatDate(selectedOrder.createdAt)}</span>
                      </div>
                      <div className="text-xs text-gray-500 mt-1">
                        {selectedOrder.user
                          ? `By ${selectedOrder.user.firstName} ${selectedOrder.user.lastName || ''}`
                          : ''}
                        {selectedOrder.customer
                          ? ` · ${selectedOrder.customer.firstName} ${selectedOrder.customer.lastName || ''}`
                          : ' · Walk-in'}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            </div>
          </div>
        </div>
      )}

      {/* Take Lay By Payment Modal */}
      {laybyPayOrder && (
        <div className="modal-backdrop-top">
          <div className="modal-content">
            <div className="max-w-2xl mx-auto">
            <div className="flex justify-between items-start mb-4">
              <button
                onClick={() => setLaybyPayOrder(null)}
                className="modal-back-btn"
                disabled={isTakingLaybyPayment}
              >
                <ArrowLeftIcon className="h-5 w-5" /> Back
              </button>
              <div className="text-right">
                <h2 className="text-xl font-bold">Lay By Payment</h2>
                <p className="text-sm text-gray-400">{laybyPayOrder.orderNumber}</p>
              </div>
            </div>

            {laybyBalance && (
              <div className="bg-pos-dark rounded-lg p-4 mb-4 grid grid-cols-3 gap-3 text-center">
                <div>
                  <p className="text-xs text-gray-400">Total</p>
                  <p className="text-lg font-bold">${laybyBalance.grandTotal.toFixed(2)}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400">Paid</p>
                  <p className="text-lg font-bold text-green-400">${laybyBalance.paid.toFixed(2)}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400">Balance</p>
                  <p className="text-lg font-bold text-amber-300">${laybyBalance.balance.toFixed(2)}</p>
                </div>
              </div>
            )}

            {/* What's actually on this lay-by, so the cashier can check
                the goods against the payment without leaving the screen. */}
            {(laybyPayOrder as any).items?.length > 0 && (
              <div className="bg-pos-dark rounded-lg p-4 mb-4">
                <p className="text-xs text-gray-400 uppercase mb-2">
                  Items on this Lay By
                </p>
                <table className="w-full text-sm">
                  <tbody>
                    {(laybyPayOrder as any).items.map((it: any) => (
                      <tr key={it.id} className="border-b border-gray-700 last:border-0">
                        <td className="py-1.5">
                          {it.quantity}× {it.name}
                          <span className="text-xs text-gray-500 font-mono ml-1">
                            {it.sku}
                          </span>
                          {it.isBackorder && (
                            <span className="ml-2 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-cyan-600/30 text-cyan-300">
                              BACKORDER
                            </span>
                          )}
                          {it.isLaybyHeld && (
                            <span className="ml-2 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-600/30 text-amber-300">
                              HELD
                            </span>
                          )}
                        </td>
                        <td className="py-1.5 text-right font-medium">
                          ${Number(it.rowTotal).toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {(laybyPayOrder as any).customer && (
                  <p className="text-xs text-gray-400 mt-2">
                    Customer: {(laybyPayOrder as any).customer.firstName}{' '}
                    {(laybyPayOrder as any).customer.lastName || ''}
                  </p>
                )}
              </div>
            )}

            <div className="space-y-3">
              <div>
                <label className="block text-xs text-gray-400 mb-1">Amount</label>
                <input
                  type="number"
                  step="0.01"
                  min={0}
                  max={laybyBalance?.balance || undefined}
                  className="input"
                  value={laybyPayAmount}
                  onChange={(e) => setLaybyPayAmount(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Method</label>
                <div className="grid grid-cols-4 gap-2">
                  {(['eftpos', 'cash', 'bank_transfer', 'store_credit'] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      className={`py-2 rounded-md border text-sm font-medium ${
                        laybyPayMethod === m
                          ? 'border-primary-500 bg-primary-500/20 text-primary-200'
                          : 'border-gray-600 text-gray-400 hover:border-gray-500'
                      }`}
                      onClick={() => setLaybyPayMethod(m)}
                    >
                      {m === 'eftpos'
                        ? 'EFTPOS'
                        : m === 'cash'
                          ? 'Cash'
                          : m === 'bank_transfer'
                            ? 'Bank Transfer'
                            : 'Store Credit'}
                    </button>
                  ))}
                </div>
              </div>
              {laybyPayMethod !== 'cash' && laybyPayMethod !== 'store_credit' && (
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Reference (optional)</label>
                  <input
                    type="text"
                    className="input"
                    value={laybyPayRef}
                    onChange={(e) => setLaybyPayRef(e.target.value)}
                  />
                </div>
              )}
            </div>

            <div className="flex justify-end gap-3 mt-6">
              <button
                className="btn-secondary"
                onClick={() => setLaybyPayOrder(null)}
                disabled={isTakingLaybyPayment}
              >
                Cancel
              </button>
              <button
                className="btn-primary bg-amber-600 hover:bg-amber-700"
                onClick={handleTakeLaybyPayment}
                disabled={isTakingLaybyPayment}
              >
                {isTakingLaybyPayment ? 'Recording...' : 'Record Payment'}
              </button>
            </div>
            </div>
          </div>
        </div>
      )}

      {/* Refund Modal */}
      {refundOrder && (
        <div className="modal-backdrop">
          <div className="modal-content">
            <div className="max-w-3xl mx-auto">
            <div className="flex justify-between items-start mb-4">
              <button
                onClick={() => setRefundOrder(null)}
                className="modal-back-btn"
                disabled={isProcessingRefund}
              >
                <ArrowLeftIcon className="h-5 w-5" /> Back
              </button>
              <div className="text-right">
                <h2 className="text-xl font-bold">Refund Order {refundOrder.orderNumber}</h2>
                <p className="text-sm text-gray-400">Select items and quantities to refund</p>
              </div>
            </div>

            {/* Credit destination banner removed per client request —
                the "Refund method" toggle above already shows where the
                refund goes. */}

            {/* Items */}
            <div className="mb-6">
              <table className="w-full text-sm">
                <thead className="bg-pos-accent">
                  <tr>
                    {/* Header checkbox = select-all across refundable
                        (non-exhausted) lines. Indeterminate when a
                        mix is selected. */}
                    <th className="px-3 py-2 w-10">
                      {(() => {
                        const eligible = refundItems.filter(
                          (i) => i.remainingQty > 0,
                        );
                        const selectedCount = eligible.filter(
                          (i) => i.selected,
                        ).length;
                        const allSelected =
                          eligible.length > 0 &&
                          selectedCount === eligible.length;
                        const someSelected =
                          selectedCount > 0 && !allSelected;
                        return (
                          <input
                            type="checkbox"
                            className="w-4 h-4"
                            title="Select / deselect all refundable lines"
                            checked={allSelected}
                            ref={(el) => {
                              if (el) el.indeterminate = someSelected;
                            }}
                            onChange={(e) => {
                              const on = e.target.checked;
                              setRefundItems((prev) =>
                                prev.map((it) =>
                                  it.remainingQty > 0
                                    ? { ...it, selected: on }
                                    : it,
                                ),
                              );
                            }}
                          />
                        );
                      })()}
                    </th>
                    <th className="px-3 py-2 text-left">Item</th>
                    <th className="px-3 py-2 text-center w-20">Remaining</th>
                    <th className="px-3 py-2 text-center w-24">Refund Qty</th>
                    <th className="px-3 py-2 text-right w-24">Unit</th>
                    <th className="px-3 py-2 text-right w-24">Line Total</th>
                    <th className="px-3 py-2 text-center w-20">Restock?</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-700">
                  {refundItems.map((item, idx) => (
                    <tr
                      key={item.orderItemId}
                      className={item.remainingQty === 0 ? 'opacity-40' : ''}
                    >
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          checked={item.selected}
                          disabled={item.remainingQty === 0}
                          onChange={(e) =>
                            updateRefundItem(idx, { selected: e.target.checked })
                          }
                          className="w-4 h-4"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <p className="font-medium">{item.name}</p>
                        <p className="text-xs text-gray-400">{item.sku}</p>
                      </td>
                      <td className="px-3 py-2 text-center">{item.remainingQty}</td>
                      <td className="px-3 py-2">
                        <input
                          type="number"
                          min={1}
                          max={item.remainingQty}
                          value={item.quantity}
                          disabled={!item.selected || item.remainingQty === 0}
                          onChange={(e) => {
                            const val = Math.max(
                              1,
                              Math.min(item.remainingQty, parseInt(e.target.value) || 1),
                            );
                            updateRefundItem(idx, { quantity: val });
                          }}
                          className="input text-center py-1 px-2 w-16 mx-auto block"
                        />
                      </td>
                      <td className="px-3 py-2 text-right">${item.unitPrice.toFixed(2)}</td>
                      <td className="px-3 py-2 text-right font-medium">
                        {item.selected ? `$${(item.unitPrice * item.quantity).toFixed(2)}` : '—'}
                      </td>
                      <td className="px-3 py-2 text-center">
                        <input
                          type="checkbox"
                          checked={item.restock}
                          disabled={!item.selected}
                          onChange={(e) => updateRefundItem(idx, { restock: e.target.checked })}
                          className="w-4 h-4"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Reason */}
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-xs text-gray-400 mb-1">Reason *</label>
                <select
                  className="input"
                  value={refundReason}
                  onChange={(e) => handleReasonChange(e.target.value)}
                >
                  {REFUND_REASONS.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex items-end">
                <div className="text-sm text-gray-400">
                  {NON_RESTOCKABLE_REASONS.has(refundReason)
                    ? 'Default: do NOT restock (override per item if needed)'
                    : 'Default: add items back to stock'}
                </div>
              </div>
            </div>

            <div className="mb-6">
              <label className="block text-xs text-gray-400 mb-1">
                Reason notes {refundReason === 'other' ? '*' : '(optional)'}
              </label>
              <textarea
                className="input min-h-[80px]"
                placeholder={
                  refundReason === 'other'
                    ? 'Explain the reason (required)'
                    : 'Additional notes (optional)'
                }
                value={refundReasonText}
                maxLength={500}
                onChange={(e) => setRefundReasonText(e.target.value)}
              />
              <p className="text-xs text-gray-500 text-right mt-1">
                {refundReasonText.length}/500
              </p>
            </div>

            {/* Refund method */}
            <div className="mb-4 p-3 rounded-lg border border-gray-600 bg-pos-accent/40">
              <p className="text-xs text-gray-400 mb-2">Refund method</p>
              <div className="flex gap-2">
                <button
                  type="button"
                  className={`flex-1 py-2 px-3 rounded-md border text-sm font-medium ${
                    !refundAsCash && refundOrder.customer
                      ? 'border-purple-500 bg-purple-500/20 text-purple-200'
                      : 'border-gray-600 text-gray-400 hover:border-gray-500'
                  }`}
                  onClick={() => setRefundAsCash(false)}
                  disabled={!refundOrder.customer}
                  title={!refundOrder.customer ? 'Walk-in order — link a customer to issue store credit' : ''}
                >
                  Store Credit
                </button>
                <button
                  type="button"
                  className={`flex-1 py-2 px-3 rounded-md border text-sm font-medium ${
                    refundAsCash || !refundOrder.customer
                      ? 'border-green-500 bg-green-500/20 text-green-200'
                      : 'border-gray-600 text-gray-400 hover:border-gray-500'
                  }`}
                  onClick={() => setRefundAsCash(true)}
                >
                  Refund
                </button>
              </div>
              {!refundOrder.customer && (
                <p className="text-xs text-gray-500 mt-2">
                  This is a walk-in order — cash refund only, unless you{' '}
                  <button
                    className="text-blue-400 underline"
                    onClick={() => {
                      setLinkOrder(refundOrder);
                      setLinkSearch('');
                      setLinkResults([]);
                      setRefundOrder(null);
                    }}
                  >
                    link a customer first
                  </button>
                  .
                </p>
              )}
            </div>

            {/* 20% restocking fee toggle — store keeps 20% of the refund
                amount, customer gets the rest. */}
            <div className="mb-4 p-3 rounded-lg border border-gray-600 bg-pos-accent/40">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={refundRestockingFee}
                  onChange={(e) => setRefundRestockingFee(e.target.checked)}
                  className="w-4 h-4"
                />
                <span className="text-sm font-medium">Apply 20% restocking fee</span>
                {refundRestockingFee && (
                  <span className="text-xs text-gray-400 ml-auto">
                    Fee retained: ${(refundTotal * 0.2).toFixed(2)} · Refund to customer: ${(refundTotal * 0.8).toFixed(2)}
                  </span>
                )}
              </label>
            </div>

            {/* Total + Actions */}
            <div className="flex justify-between items-center border-t border-gray-700 pt-4">
              <div>
                <p className="text-sm text-gray-400">
                  Refund total
                  {refundRestockingFee && ' — after 20% fee'}
                </p>
                <p className="text-2xl font-bold text-orange-400">
                  ${(refundRestockingFee ? refundTotal * 0.8 : refundTotal).toFixed(2)}
                </p>
              </div>
              <div className="flex gap-3">
                <button
                  className="btn-secondary"
                  onClick={() => setRefundOrder(null)}
                  disabled={isProcessingRefund}
                >
                  Cancel
                </button>
                {/* Exchange: return to store credit + go to POS to ring
                    the replacement (needs a linked customer). */}
                <button
                  className="btn-primary bg-cyan-600 hover:bg-cyan-700"
                  onClick={() => processRefund(true)}
                  disabled={
                    isProcessingRefund ||
                    refundTotal === 0 ||
                    !refundOrder.customer
                  }
                  title={
                    !refundOrder.customer
                      ? 'Link a customer first to exchange (store credit)'
                      : 'Return to store credit and ring the replacement'
                  }
                >
                  {refundAsCash ? 'Refund & Exchange' : 'Refund Credits & Exchange'}
                </button>
                <button
                  className="btn-primary bg-orange-600 hover:bg-orange-700"
                  onClick={() => processRefund(false)}
                  disabled={isProcessingRefund || refundTotal === 0}
                >
                  {isProcessingRefund
                    ? 'Processing...'
                    : refundAsCash
                      ? 'Process Refund'
                      : 'Refund Credits'}
                </button>
              </div>
            </div>
            </div>
          </div>
        </div>
      )}

      {/* Link Customer modal — shown when user tries to refund a walk-in order */}
      {linkOrder && (
        <div className="modal-backdrop-top">
          <div className="modal-content">
            <div className="flex justify-between items-start mb-4">
              <button
                onClick={() => setLinkOrder(null)}
                className="modal-back-btn"
                disabled={isLinking}
              >
                <ArrowLeftIcon className="h-5 w-5" /> Back
              </button>
              <div className="text-right">
                <h3 className="text-lg font-bold">Link Customer to Order</h3>
                <p className="text-sm text-gray-400">
                  {linkOrder.orderNumber} is a walk-in order. Attach a customer
                  so store credit can be issued on refund.
                </p>
              </div>
            </div>

            <div className="mb-4">
              <label className="block text-xs text-gray-400 mb-1">
                Search by name, email, phone or company
              </label>
              <input
                type="text"
                className="input"
                autoComplete="off"
                placeholder="Start typing…"
                value={linkSearch}
                onChange={(e) => setLinkSearch(e.target.value)}
              />
            </div>

            {linkSearch.trim().length >= 2 && (
              <div className="bg-pos-accent border border-gray-600 rounded-lg max-h-64 overflow-auto">
                {linkLoading && (
                  <div className="px-4 py-3 text-sm text-gray-400">Searching…</div>
                )}
                {!linkLoading && linkResults.length === 0 && (
                  <div className="px-4 py-3 text-sm text-gray-400">
                    No customers matched "{linkSearch}". Create one on the Customers page, then come back.
                  </div>
                )}
                {linkResults.map((c: any) => (
                  <button
                    key={c.id}
                    className="w-full text-left px-4 py-3 hover:bg-pos-card border-b border-gray-700 last:border-0 disabled:opacity-50"
                    disabled={isLinking}
                    onClick={() => handleLinkPick(c)}
                  >
                    <p className="font-medium">
                      {c.firstName} {c.lastName}
                      {c.isTrade && (
                        <span className="ml-2 px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase bg-orange-600/30 text-orange-300">
                          Trade
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-gray-400">
                      ID: {c.id}
                      {c.email ? ` | ${c.email}` : ''}
                      {c.phone ? ` | ${c.phone}` : ''}
                    </p>
                  </button>
                ))}
              </div>
            )}

            <div className="flex justify-end gap-3 mt-4">
              <button
                className="btn-secondary"
                onClick={() => setLinkOrder(null)}
                disabled={isLinking}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Lay By instalment receipt (print view) */}
      {laybyReceipt && (
        <div className="modal-backdrop print:bg-white print:static">
          <div className="modal-content bg-white text-black p-8 print:shadow-none printable-root">
            <div className="text-center mb-4">
              <h2 className="text-2xl font-bold">
                {laybyReceipt.isFinal ? 'LAY BY FINAL PAYMENT' : 'LAY BY PAYMENT RECEIPT'}
              </h2>
              <p className="text-sm text-gray-600">Australian Lighting &amp; Fans</p>
            </div>

            <div className="border-t border-b border-gray-300 py-3 mb-4 text-sm space-y-1">
              <div className="flex justify-between">
                <span>Order:</span>
                <span className="font-medium">{laybyReceipt.order.orderNumber}</span>
              </div>
              <div className="flex justify-between">
                <span>Date:</span>
                <span>{formatDate(laybyReceipt.date)}</span>
              </div>
              <div className="flex justify-between">
                <span>Method:</span>
                <span className="capitalize">
                  {String(laybyReceipt.method).replace('_', ' ')}
                </span>
              </div>
              {laybyReceipt.reference && (
                <div className="flex justify-between">
                  <span>Reference:</span>
                  <span>{laybyReceipt.reference}</span>
                </div>
              )}
              {laybyReceipt.order.customer && (
                <div className="flex justify-between">
                  <span>Customer:</span>
                  <span>
                    {laybyReceipt.order.customer.firstName}{' '}
                    {laybyReceipt.order.customer.lastName || ''}
                  </span>
                </div>
              )}
            </div>

            {laybyReceipt.order.items?.length > 0 && (
              <div className="mb-4">
                <p className="text-sm font-semibold mb-2">Items on Lay By</p>
                <table className="w-full text-sm">
                  <tbody>
                    {laybyReceipt.order.items.map((it: any) => (
                      <tr key={it.id} className="border-b border-gray-200">
                        <td className="py-1">
                          {it.quantity}x {it.name}
                        </td>
                        <td className="py-1 text-right">
                          ${Number(it.rowTotal).toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="border-t border-gray-300 pt-3 mb-6 text-sm space-y-1">
              <div className="flex justify-between">
                <span>Order total</span>
                <span>${laybyReceipt.grandTotal.toFixed(2)}</span>
              </div>
              <div className="flex justify-between font-bold text-lg">
                <span>Paid this visit</span>
                <span>${laybyReceipt.amount.toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span>Paid to date</span>
                <span>${laybyReceipt.paidToDate.toFixed(2)}</span>
              </div>
              <div className="flex justify-between font-bold">
                <span>Balance owing</span>
                <span>${laybyReceipt.balanceAfter.toFixed(2)}</span>
              </div>
              {laybyReceipt.isFinal && (
                <p className="text-xs text-gray-600 pt-2">
                  Lay By paid in full — goods may be released to the customer.
                </p>
              )}
            </div>

            <div className="flex gap-3 print:hidden">
              <button
                className="btn-secondary flex-1"
                onClick={() => setLaybyReceipt(null)}
              >
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

      {/* Refund Receipt (print view) */}
      {completedRefund && (
        <div className="modal-backdrop print:bg-white print:static">
          <div className="modal-content bg-white text-black p-8 print:shadow-none printable-root">
            <div className="text-center mb-4">
              <h2 className="text-2xl font-bold">REFUND RECEIPT</h2>
              <p className="text-sm text-gray-600">Australian Lighting & Fans</p>
            </div>

            <div className="border-t border-b border-gray-300 py-3 mb-4 text-sm space-y-1">
              <div className="flex justify-between">
                <span>Original Order:</span>
                <span className="font-medium">{completedRefund.order.orderNumber}</span>
              </div>
              <div className="flex justify-between">
                <span>Refund Date:</span>
                <span>{formatDate(completedRefund.refund.createdAt)}</span>
              </div>
              <div className="flex justify-between">
                <span>Processed by:</span>
                <span>
                  {completedRefund.refund.user
                    ? `${completedRefund.refund.user.firstName} ${completedRefund.refund.user.lastName}`
                    : '—'}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Reason:</span>
                <span>
                  {REFUND_REASONS.find((r) => r.value === completedRefund.refund.reason)?.label}
                </span>
              </div>
              {completedRefund.refund.reasonText && (
                <div className="pt-1 text-xs text-gray-600">
                  "{completedRefund.refund.reasonText}"
                </div>
              )}
            </div>

            {/* The whole original order, with what's come back marked.
                Sally: "on the receipt can it display the whole order
                that was brought and display what was refunded, and this
                continues if another exchange refund occurs". Prior
                refunds are folded in so the running picture is right on
                the second and third visit. */}
            {(() => {
              const orderItems = completedRefund.order?.items || [];
              if (orderItems.length === 0) return null;
              // qty refunded BEFORE this refund, per order item
              const priorQty: Record<number, number> = {};
              for (const r of completedRefund.order?.refunds || []) {
                if (r.id === completedRefund.refund.id) continue;
                for (const ri of r.items || []) {
                  priorQty[ri.orderItemId] =
                    (priorQty[ri.orderItemId] || 0) + Number(ri.quantity || 0);
                }
              }
              // qty refunded by THIS refund
              const nowQty: Record<number, number> = {};
              for (const ri of completedRefund.refund.items || []) {
                nowQty[ri.orderItemId] =
                  (nowQty[ri.orderItemId] || 0) + Number(ri.quantity || 0);
              }
              return (
                <div className="mb-4">
                  <p className="text-sm font-semibold mb-2">
                    Original Order — {completedRefund.order.orderNumber}
                  </p>
                  <table className="w-full text-sm">
                    <tbody>
                      {orderItems.map((oi: any) => {
                        const prior = priorQty[oi.id] || 0;
                        const now = nowQty[oi.id] || 0;
                        const kept = Number(oi.quantity) - prior - now;
                        return (
                          <tr key={oi.id} className="border-b border-gray-200">
                            <td className="py-1">
                              {oi.quantity}x {oi.name}
                              <div className="text-xs text-gray-600">
                                {now > 0 && (
                                  <span className="font-semibold">
                                    {now} returned now
                                  </span>
                                )}
                                {now > 0 && prior > 0 ? ' · ' : ''}
                                {prior > 0 && (
                                  <span>{prior} returned earlier</span>
                                )}
                                {(now > 0 || prior > 0) && kept > 0
                                  ? ` · ${kept} kept`
                                  : ''}
                                {now === 0 && prior === 0 ? 'Kept' : ''}
                              </div>
                            </td>
                            <td className="py-1 text-right align-top">
                              ${Number(oi.rowTotal).toFixed(2)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  <div className="flex justify-between text-sm mt-1 pt-1 border-t border-gray-300">
                    <span>Order total</span>
                    <span>
                      ${parseFloat(completedRefund.order.grandTotal).toFixed(2)}
                    </span>
                  </div>
                </div>
              );
            })()}

            <div className="mb-4">
              <p className="text-sm font-semibold mb-2">Refunded Items</p>
              <table className="w-full text-sm">
                <tbody>
                  {completedRefund.refund.items.map((ri: any) => {
                    const meta = completedRefund.itemsByOrderItemId[ri.orderItemId];
                    return (
                      <tr key={ri.id} className="border-b border-gray-200">
                        <td className="py-1">
                          {ri.quantity}x {meta?.name || `Item #${ri.orderItemId}`}
                          {!ri.restock && (
                            <span className="text-xs text-red-600 ml-1">(not restocked)</span>
                          )}
                        </td>
                        <td className="py-1 text-right">${ri.amount.toFixed(2)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="border-t border-gray-300 pt-3 mb-6">
              <div className="flex justify-between font-bold text-lg">
                <span>Total Refunded</span>
                <span>${completedRefund.refund.refundAmount.toFixed(2)}</span>
              </div>
              <p className="text-xs text-gray-600 mt-2">
                {completedRefund.refund.isFullRefund
                  ? 'This order has been fully refunded.'
                  : 'This is a partial refund. Remaining balance stays with original payment.'}
              </p>
            </div>

            <div className="flex gap-3 print:hidden">
              <button className="btn-secondary flex-1" onClick={() => setCompletedRefund(null)}>
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
