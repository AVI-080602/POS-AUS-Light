import { useState, useEffect, useRef } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useSelector } from 'react-redux';
import toast from 'react-hot-toast';
import { ordersApi, syncApi, customersApi } from '../../services/api';
import { RootState } from '../../store';
import { buildInvoiceData } from '../../utils/orderInvoice';
import InvoiceModal from '../pos/components/InvoiceModal';
import EditOrderItemsModal from './EditOrderItemsModal';
import CollectItemsModal, { isOpenLine } from './CollectItemsModal';
import OrderHistoryTimeline from './OrderHistoryTimeline';
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
  ArrowDownTrayIcon,
  TagIcon,
  UserPlusIcon,
} from '@heroicons/react/24/outline';
import { formatPhone } from '../../utils/phone';
import { customerTicketHtml, printTicketHtml, CustomerTicket } from '../../utils/ticket';

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
  source?: 'pos' | 'magento' | 'legacy';
  legacyFile?: string | null;
  orderType?: 'standard' | 'layby';
  laybyExpiresAt?: string | null;
  hasBackorderItems?: boolean;
  backorderOpenCount?: number;
  backorderFulfilledCount?: number;
  laybyHeldCount?: number;
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
  | 'legacy'
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
  { value: 'legacy', label: 'Old Invoices (imported)' },
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
  // Line status flags so the refund screen can show the same badges as
  // the order screen (Sally, 10 Sep, row 471).
  isBackorder: boolean;
  backorderFulfilledAt: string | null;
  isLaybyHeld: boolean;
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
  // What's actually searched: the box after a short pause in typing (or
  // straight away on Enter). Searching on every keystroke let the slow
  // reply for "7" land after the one for "7000027808" and put the full
  // list back (Sally, 19 Oct 2026).
  const [query, setQuery] = useState('');
  const latestFetch = useRef(0);
  useEffect(() => {
    const t = setTimeout(() => setQuery(search.trim()), 350);
    return () => clearTimeout(t);
  }, [search]);
  useEffect(() => {
    setPagination((p) => (p.page === 1 ? p : { ...p, page: 1 }));
  }, [query]);
  const [filter, setFilter] = useState<FilterOption>('all');
  const [selectedOrder, setSelectedOrder] = useState<any>(null);
  // "Edit Items" modal target — clone selectedOrder into this state to
  // open it. Closed on cancel or after a successful save (which also
  // refreshes selectedOrder).
  const [editItemsOrder, setEditItemsOrder] = useState<any>(null);
  const [collectOrder, setCollectOrder] = useState<any>(null);
  const [invoiceData, setInvoiceData] = useState<any>(null);
  // Order-notes edit-in-place: null = not editing, string = current
  // draft. Committing sends a PATCH and refreshes the selected order.
  const [notesDraft, setNotesDraft] = useState<string | null>(null);
  const [savingNotes, setSavingNotes] = useState(false);
  // Second note box (Sally, 26 Aug): staff-only internal note, edited
  // the same way but saved to order.internalNotes.
  const [internalNotesDraft, setInternalNotesDraft] = useState<string | null>(null);

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

  const saveInternalNotes = async () => {
    if (!selectedOrder || internalNotesDraft === null) return;
    setSavingNotes(true);
    try {
      await ordersApi.updateNotes(
        selectedOrder.id,
        undefined,
        internalNotesDraft.trim() || null,
      );
      const fresh = await ordersApi.getOrder(selectedOrder.id);
      setSelectedOrder({
        ...fresh.data.data.order,
        refunds: selectedOrder?.refunds || [],
      });
      setInternalNotesDraft(null);
      toast.success('Internal note saved');
    } catch {
      toast.error('Failed to save internal note');
    } finally {
      setSavingNotes(false);
    }
  };

  const printInvoice = async (orderId: number) => {
    try {
      // Refunds ride along so a reprint after a partial refund marks the
      // returned lines and shows the refunded total instead of reading
      // like the original untouched sale.
      const [r, refundsRes] = await Promise.all([
        ordersApi.getOrder(orderId),
        ordersApi.getRefunds(orderId).catch(() => null),
      ]);
      const o = r.data?.data?.order;
      if (!o) {
        toast.error('Could not load order for printing');
        return;
      }
      // An exchange's replacement order: print what came back too, from
      // the refund on the original order made just before this sale.
      let exchangeRefund: any;
      if (o.exchangeFromOrder?.id) {
        try {
          const er = await ordersApi.getRefunds(o.exchangeFromOrder.id);
          const before = (er.data?.data?.refunds || []).filter(
            (rf: any) => new Date(rf.createdAt).getTime() <= new Date(o.createdAt).getTime() + 60000,
          );
          exchangeRefund = before.sort(
            (a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
          )[0];
        } catch {
          exchangeRefund = undefined;
        }
      }
      setInvoiceData(
        buildInvoiceData(o, undefined, refundsRes?.data?.data?.refunds || [], exchangeRefund),
      );
    } catch {
      toast.error('Could not load order for printing');
    }
  };

  // Refund modal state
  const [refundOrder, setRefundOrder] = useState<any>(null);

  // Link-customer flow — walk-in orders that need a customer before a
  // refund, or from the order screen's Customer card (Sally, 16 Oct 2026:
  // the customer's details belong on the order and its ticket).
  const [linkOrder, setLinkOrder] = useState<Order | null>(null);
  const [linkThen, setLinkThen] = useState<'refund' | 'order' | 'ticket'>('refund');
  // Customer ticket preview (89 x 36 mm label for the stock's box).
  const [ticketFor, setTicketFor] = useState<any>(null);
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
  // Change a payment's method on the order screen (Sally, 13 Oct 2026:
  // EFTPOS declined after the sale, customer paid cash).
  const [payEdit, setPayEdit] = useState<{ id: number; method: string; reference: string } | null>(null);
  const [paySaving, setPaySaving] = useState(false);
  const payMethodLabel = (m: string) =>
    m === 'eftpos'
      ? 'EFTPOS'
      : m === 'bank_transfer'
        ? 'Bank Transfer'
        : m === 'store_credit'
          ? 'Store Credit'
          : m === 'cash'
            ? 'Cash'
            : m === 'credit_card'
              ? 'Credit Card'
              : m;

  useEffect(() => {
    fetchOrders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pagination.page, query, filter]);

  const fetchOrders = async () => {
    // Only the newest request may fill the list.
    const fetchId = ++latestFetch.current;
    try {
      setIsLoading(true);
      // Map the combined filter to the actual query params
      const params: any = {
        search: query || undefined,
        page: pagination.page,
        limit: 20,
      };
      if (filter === 'pos' || filter === 'magento' || filter === 'legacy') {
        params.source = filter;
      } else if (filter === 'layby') {
        params.type = 'layby';
      } else if (filter !== 'all') {
        params.status = filter;
      }

      const response = await ordersApi.getOrders(params);
      if (fetchId !== latestFetch.current) return;
      setOrders(response.data.data.orders);
      setPagination(response.data.data.pagination);
    } catch (error) {
      console.error('Failed to fetch orders:', error);
    } finally {
      if (fetchId === latestFetch.current) setIsLoading(false);
    }
  };

  // Opened from elsewhere with an order to show (Reports > Backorders
  // order number, Sally 15 Oct 2026) — open it, then clear the state so a
  // refresh doesn't reopen it.
  const location = useLocation();
  // Back / Cancel on an order opened from another screen returns there
  // (Sally, 16 Oct 2026: from Backorders, Back should go to Backorders).
  const [returnTo, setReturnTo] = useState<{ path: string; tab?: string; orderId: number } | null>(null);
  useEffect(() => {
    const st = location.state as any;
    const id = Number(st?.openOrderId);
    if (id > 0) {
      setReturnTo(st?.returnTo?.path ? { path: st.returnTo.path, tab: st.returnTo.tab, orderId: id } : null);
      viewOrder(id);
      navigate(location.pathname, { replace: true, state: null });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state]);
  const closeOrder = () => {
    const back = returnTo && selectedOrder && returnTo.orderId === selectedOrder.id ? returnTo : null;
    setSelectedOrder(null);
    setReturnTo(null);
    if (back) navigate(back.path, { state: back.tab ? { tab: back.tab } : undefined });
  };

  const viewOrder = async (id: number) => {
    try {
      const [orderRes, refundsRes] = await Promise.all([
        ordersApi.getOrder(id),
        ordersApi.getRefunds(id),
      ]);
      const full = orderRes.data.data.order;
      setSelectedOrder({
        ...full,
        refunds: refundsRes.data.data.refunds,
      });
      // The order screen takes the balance payment inline (Sally, 10 Sep,
      // row 467: open orders in the Balance Payment format).
      setLaybyPayAmount(balanceDue(full).toFixed(2));
      setLaybyPayMethod('eftpos');
      setLaybyPayRef('');
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
          // Starts at 0 so the cashier types the quantity being
          // returned (Sally, 10 Sep: "Make number to Zero in refund qty").
          quantity: 0,
          restock: true,
          isBackorder: !!item.isBackorder,
          backorderFulfilledAt: item.backorderFulfilledAt || null,
          isLaybyHeld: !!item.isLaybyHeld,
        };
      });

      // Refunds ride on the order object so the history timeline in
      // this modal can render them (Sally opens orders through here).
      setRefundOrder({ ...fullOrder, refunds: existingRefunds });
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

  // Per-line status change from the order screen (Sally, 10 Sep). The
  // dropdown's current value is derived from the line's flags; the
  // server rewrites them, nudges the order status and logs an event.
  const [itemStatusSaving, setItemStatusSaving] = useState<number | null>(null);
  const lineStatusValue = (item: any): 'backorder' | 'layby' | 'paid' =>
    item.isBackorder && !item.backorderFulfilledAt
      ? 'backorder'
      : item.isLaybyHeld
        ? 'layby'
        : 'paid';
  const handleSetItemStatus = async (
    order: any,
    item: any,
    status: 'backorder' | 'layby' | 'paid',
  ) => {
    if (lineStatusValue(item) === status) return;
    setItemStatusSaving(item.id);
    try {
      await ordersApi.setItemStatus(order.id, item.id, status);
      const fresh = await ordersApi.getOrder(order.id);
      setSelectedOrder({ ...fresh.data.data.order, refunds: order.refunds || [] });
      toast.success(
        `${item.name} marked ${status === 'backorder' ? 'Back Order' : status === 'layby' ? 'Lay-by' : 'Complete'}`,
      );
      fetchOrders();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Failed to change item status');
    } finally {
      setItemStatusSaving(null);
    }
  };
  // Website orders: Back Order (with how many) / Complete per line, so
  // purchasing can order website lines on the same PO as POS ones (Sally,
  // 16 Oct 2026). Shown while Magento has the order open, or while a line
  // is still on back order.
  const [webQty, setWebQty] = useState<Record<number, string>>({});
  const webLineEditable = (o: any, item: any) =>
    isWebOrder(o) &&
    !['cancelled', 'refunded'].includes(o.status) &&
    (['pending', 'processing'].includes(o.status) || (item.isBackorder && !item.backorderFulfilledAt));
  const handleWebLine = async (order: any, item: any, status: 'backorder' | 'complete') => {
    const qty = Math.floor(Number(webQty[item.id] ?? item.backorderQty ?? item.quantity));
    if (status === 'backorder' && (!Number.isFinite(qty) || qty < 1 || qty > item.quantity)) {
      toast.error(`Enter how many to order: 1 to ${item.quantity}`);
      return;
    }
    setItemStatusSaving(item.id);
    try {
      await ordersApi.setWebsiteLineStatus(order.id, item.id, status, status === 'backorder' ? qty : undefined);
      const fresh = await ordersApi.getOrder(order.id);
      setSelectedOrder({ ...fresh.data.data.order, refunds: order.refunds || [] });
      setWebQty((m) => {
        const next = { ...m };
        delete next[item.id];
        return next;
      });
      toast.success(
        status === 'backorder'
          ? `${qty} × ${item.sku} on back order — it's on Reports > Backorders`
          : `${item.sku} back order complete`,
      );
      fetchOrders();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Could not update the line');
    } finally {
      setItemStatusSaving(null);
    }
  };

  // Refunded quantity per line, from the refunds already loaded on the
  // selected order, so a line can show Lay-by AND Refunded together.
  const refundedQtyFor = (order: any, itemId: number): number =>
    (order?.refunds || []).reduce(
      (sum: number, r: any) =>
        sum +
        (r.items || [])
          .filter((ri: any) => ri.orderItemId === itemId)
          .reduce((s2: number, ri: any) => s2 + (Number(ri.quantity) || 0), 0),
      0,
    );

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
      toast.error('Enter a refund quantity for at least one item');
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
      // The order screen stays open underneath — bring it up to date.
      if (selectedOrder) viewOrder(selectedOrder.id);
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

  const getStatusBadge = (status: string, hasExchange = false, voided = false) => {
    if (voided) {
      return (
        <span className="px-2 py-1 rounded text-xs font-medium whitespace-nowrap bg-red-700 text-white" title="Voided sale — not counted anywhere">
          VOID
        </span>
      );
    }
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

  // Money already taken against an order (deposit + instalments) and
  // what's still owed. Payments come back on the order detail payload.
  // Website orders were paid in Magento — no POS payment rows.
  const isWebOrder = (o: any) => o?.source === 'magento';
  // Nothing can be changed on a website order or a voided sale.
  const isLocked = (o: any) => isWebOrder(o) || !!o?.voidedAt;
  // Void a sale put through by mistake (Sally, 17 Oct 2026) — admins.
  const isAdmin = user?.role.name === 'admin';
  const [voidFor, setVoidFor] = useState<any>(null);
  const [voidReason, setVoidReason] = useState('');
  const [voiding, setVoiding] = useState(false);
  const canVoid = (o: any) =>
    isAdmin && o?.source === 'pos' && !o?.voidedAt && o?.status !== 'cancelled' && !(o?.refunds || []).length;
  const handleVoid = async () => {
    if (!voidFor) return;
    if (voidReason.trim().length < 3) {
      toast.error('Say why the sale is being voided');
      return;
    }
    setVoiding(true);
    try {
      await ordersApi.voidOrder(voidFor.id, voidReason.trim());
      toast.success(`${voidFor.orderNumber} voided — it's out of the sales reports`);
      const id = voidFor.id;
      setVoidFor(null);
      setVoidReason('');
      await viewOrder(id);
      fetchOrders();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Could not void the sale');
    } finally {
      setVoiding(false);
    }
  };
  const paidTotal = (o: any) =>
    isWebOrder(o) && !(o?.payments || []).length
      ? ['paid', 'refunded'].includes(o.paymentStatus)
        ? parseFloat(o.grandTotal)
        : 0
      : (o?.payments || [])
          .filter((p: any) => !p.status || p.status === 'completed')
          .reduce((s: number, p: any) => s + Number(p.amount || 0), 0);
  const balanceDue = (o: any) =>
    Math.max(
      0,
      Math.round((parseFloat(o.grandTotal) - paidTotal(o)) * 100) / 100,
    );
  // Orders that can take a balance payment via the PAY flow: laybys and
  // backorders that took a deposit (Sally, 9 Sep: POS ORDER 0067 needs a
  // PAY button so the customer can complete payment), and a finished sale
  // that had lights added afterwards (Sally, 4 Nov 2026).
  const canTakePayment = (o: any) =>
    !isWebOrder(o) &&
    (['layby_active', 'layby_expired'].includes(o.status) ||
      (['backorder_pending', 'pending', 'processing', 'complete'].includes(o.status) &&
        o.paymentStatus !== 'paid'));

  // Customer ticket for the box (Sally, 16 Oct 2026). Website orders keep
  // the buyer's phone in the import note.
  const ticketData = (o: any): CustomerTicket => {
    const c = o.customer;
    const webPhone = isWebOrder(o) ? /Phone: ([^·]+)/.exec(o.internalNotes || '')?.[1]?.trim() : '';
    return {
      orderNumber: o.orderNumber,
      name: c ? [c.firstName, c.lastName].filter(Boolean).join(' ') : o.customerNameSnapshot || '',
      company: c?.company || null,
      phone: formatPhone(c ? c.phone || c.mobile : webPhone) || null,
      printedOn: new Date().toLocaleDateString('en-AU', { day: '2-digit', month: '2-digit', year: 'numeric' }),
    };
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
      if (linkThen !== 'refund') {
        const r = await ordersApi.getOrder(linkOrder.id);
        const fresh = r.data.data.order;
        setSelectedOrder((cur: any) => (cur && cur.id === fresh.id ? { ...fresh, refunds: cur.refunds } : cur));
        if (linkThen === 'ticket') setTicketFor(fresh);
        setLinkOrder(null);
        setLinkSearch('');
        setLinkResults([]);
        fetchOrders();
        return;
      }
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

  // Record Payment from the order screen itself (Sally, 10 Sep, row 467).
  // Same API as the standalone Balance Payment modal; on success the
  // instalment receipt pops and the order screen refreshes in place.
  const handleRecordInlinePayment = async () => {
    if (!selectedOrder) return;
    const amount = parseFloat(laybyPayAmount);
    if (!amount || amount <= 0) {
      toast.error('Enter a payment amount');
      return;
    }
    setIsTakingLaybyPayment(true);
    try {
      const res = await ordersApi.takeLaybyPayment(selectedOrder.id, {
        amount,
        method: laybyPayMethod,
        reference: laybyPayRef.trim() || undefined,
      });
      const newStatus = res.data?.data?.order?.status;
      if (newStatus === 'complete') {
        toast.success(`${selectedOrder.orderNumber} fully paid — marked complete`);
      } else {
        toast.success(`Payment of $${amount.toFixed(2)} recorded`);
      }
      const priorPaid = paidTotal(selectedOrder);
      const total = parseFloat(selectedOrder.grandTotal);
      setLaybyReceipt({
        order: selectedOrder,
        amount,
        method: laybyPayMethod,
        reference: laybyPayRef.trim() || null,
        paidToDate: Math.round((priorPaid + amount) * 100) / 100,
        balanceAfter: Math.max(0, Math.round((total - priorPaid - amount) * 100) / 100),
        grandTotal: total,
        isFinal: newStatus === 'complete',
        date: new Date().toISOString(),
      });
      await viewOrder(selectedOrder.id);
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
            onKeyDown={(e) => {
              if (e.key === 'Enter') setQuery(search.trim());
            }}
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
                            : order.source === 'legacy'
                              ? 'bg-gray-500/30 text-gray-300'
                              : 'bg-blue-600/30 text-blue-300'
                        }`}
                        title={order.source === 'legacy' ? 'Imported from the old invoice system' : undefined}
                      >
                        {order.source === 'magento' ? 'M2' : order.source === 'legacy' ? 'OLD' : 'POS'}
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
                    {/* Sally, 7 Sep: clicking the customer's name opens
                        the order, same as the yellow arrow. Since 10 Sep
                        (row 467) that is the order screen in the Balance
                        Payment format; Refund lives on it. */}
                    <button
                      onClick={() => viewOrder(order.id)}
                      className="text-left hover:underline"
                      title="Open this order"
                    >
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
                            {order.source === 'magento' ? 'WEBSITE' : 'WALK-IN'}
                          </span>
                        </span>
                      ) : order.source === 'magento' ? (
                        'Website guest'
                      ) : (
                        'Walk-in'
                      )}
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    {/* Per-line statuses in the summary (Sally, 10 Sep:
                        "multiple statuses must be displayed in the order
                        summary"). */}
                    <div className="flex items-center gap-1 flex-wrap">
                      <span>{order.itemCount}</span>
                      {(order.backorderOpenCount ?? 0) > 0 && (
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase bg-cyan-600/30 text-cyan-300 whitespace-nowrap">
                          {order.backorderOpenCount} Back Order
                        </span>
                      )}
                      {(order.laybyHeldCount ?? 0) > 0 && (
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase bg-amber-600/30 text-amber-300 whitespace-nowrap">
                          {order.laybyHeldCount} Lay-by
                        </span>
                      )}
                      {(order.backorderFulfilledCount ?? 0) > 0 && (
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase bg-green-600/30 text-green-300 whitespace-nowrap">
                          {order.backorderFulfilledCount} Received
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 font-medium">${order.grandTotal.toFixed(2)}</td>
                  <td className="px-4 py-3">
                    {getStatusBadge(
                      order.status,
                      !!(order as any).hasExchange,
                      !!(order as any).voidedAt,
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
                      {/* PAY — any order still owed money (lay-by, or a
                          backorder that took a deposit) can collect the
                          balance from here (Sally, 9 Sep: order 0067). */}
                      {canTakePayment(order) && (
                        <button
                          onClick={() => openLaybyPay(order)}
                          className="p-2 hover:bg-amber-500/20 text-amber-300 rounded"
                          title="PAY — take balance payment"
                        >
                          <BanknotesIcon className="h-5 w-5" />
                        </button>
                      )}
                      {/* Shown for EVERY status (Sally, 25 Aug: "Staff
                          need to open and edit all orders") — on fully
                          refunded orders the modal simply has nothing
                          left to select, but Add Lights still works. */}
                      {canRefund && order.source !== 'magento' && (
                        <button
                          onClick={() => viewOrder(order.id)}
                          className="p-2 hover:bg-orange-500/20 text-orange-400 rounded"
                          title="Open Order — refund, exchange, add lights, take payment"
                        >
                          <ArrowUturnLeftIcon className="h-5 w-5" />
                        </button>
                      )}
                      {/* Magento push retry — manager/admin only (Sally,
                          7 Sep: staff level doesn't need the cloud icon). */}
                      {(user?.role.name === 'admin' || user?.role.name === 'manager') &&
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

      {collectOrder && (
        <CollectItemsModal
          order={collectOrder}
          onClose={() => setCollectOrder(null)}
          onSaved={async () => {
            const id = collectOrder.id;
            setCollectOrder(null);
            try {
              const fresh = await ordersApi.getOrder(id);
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
            {/* Order screen in the Balance Payment format (Sally, 10 Sep,
                row 467: "when opening an order show the screen in this
                format"): status + order number up top, Order Total / Paid
                / Balance tiles, the item list with every status badge,
                the payment fields inline, then Cancel / Add Lights /
                Refund Credits & Exchange / Refund / Record Payment, with
                the Order History underneath. */}
            <div className="flex justify-between items-start mb-4 gap-3 flex-wrap">
              <button onClick={closeOrder} className="modal-back-btn">
                <ArrowLeftIcon className="h-5 w-5" /> Back
              </button>
              <div className="flex items-center gap-2">
                {getStatusBadge(
                  selectedOrder.status,
                  (selectedOrder.exchangedToOrders || []).length > 0,
                  !!selectedOrder.voidedAt,
                )}
                <h2 className="text-xl font-bold">Order {selectedOrder.orderNumber}</h2>
              </div>
              <div className="text-right">
                <div className="flex items-center justify-end gap-2 mb-1">
                  {!isWebOrder(selectedOrder) &&
                    ['pending', 'processing', 'backorder_pending', 'layby_active', 'layby_expired'].includes(
                    selectedOrder.status,
                  ) && (
                    <button
                      className="btn-secondary text-xs py-1"
                      onClick={() => setEditItemsOrder(selectedOrder)}
                      title="Add/remove products, fix quantities or prices, or change what's on back order / lay-by"
                    >
                      Edit Items
                    </button>
                  )}
                  <button
                    className="btn-secondary flex items-center gap-1 text-xs py-1"
                    onClick={() => {
                      const id = selectedOrder.id;
                      setSelectedOrder(null);
                      printInvoice(id);
                    }}
                  >
                    <PrinterIcon className="h-4 w-4" /> Print Invoice
                  </button>
                  {/* Label for the stock's box when it arrives (Sally,
                      16 Oct 2026) — same 89 x 36 mm stock as the product
                      sale ticket. */}
                  <button
                    className="btn-secondary flex items-center gap-1 text-xs py-1"
                    title="Print a label with the order number, customer, phone and today's date for the box"
                    onClick={() => setTicketFor(selectedOrder)}
                  >
                    <TagIcon className="h-4 w-4" /> Customer Ticket
                  </button>
                  {/* Orders imported from the old Excel system keep the
                      exact invoice the customer received. */}
                  {selectedOrder.legacyFile && (
                    <button
                      className="btn-secondary flex items-center gap-1 text-xs py-1"
                      title="Download the original invoice exactly as it was issued (Excel)"
                      onClick={async () => {
                        try {
                          const r = await ordersApi.getOriginalInvoice(selectedOrder.id);
                          const url = URL.createObjectURL(r.data);
                          const a = document.createElement('a');
                          a.href = url;
                          a.download = `${selectedOrder.orderNumber}-original${
                            String(selectedOrder.legacyFile).toLowerCase().endsWith('.xls') ? '.xls' : '.xlsx'
                          }`;
                          document.body.appendChild(a);
                          a.click();
                          a.remove();
                          setTimeout(() => URL.revokeObjectURL(url), 10000);
                        } catch {
                          toast.error('Original invoice file is not available');
                        }
                      }}
                    >
                      <ArrowDownTrayIcon className="h-4 w-4" /> Original Invoice
                    </button>
                  )}
                </div>
                <h3 className="text-lg font-semibold">
                  {canTakePayment(selectedOrder)
                    ? selectedOrder.orderType === 'layby'
                      ? 'Lay By Payment'
                      : 'Balance Payment'
                    : 'Order Details'}
                </h3>
                <p className="text-sm text-gray-400">
                  {selectedOrder.orderNumber} · {formatDate(selectedOrder.createdAt)}
                </p>
              </div>
            </div>

            <div className="space-y-4">
              <div className="bg-pos-dark rounded-lg p-4 grid grid-cols-3 gap-3 text-center">
                <div>
                  <p className="text-xs text-gray-400">Order Total</p>
                  <p className="text-lg font-bold">${parseFloat(selectedOrder.grandTotal).toFixed(2)}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400">Paid</p>
                  <p className="text-lg font-bold text-green-400">${paidTotal(selectedOrder).toFixed(2)}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400">Balance</p>
                  <p className={`text-lg font-bold ${balanceDue(selectedOrder) > 0.005 ? 'text-amber-300' : 'text-green-400'}`}>
                    ${balanceDue(selectedOrder).toFixed(2)}
                  </p>
                </div>
              </div>

              {selectedOrder.voidedAt && (
                <div className="rounded-lg p-3 text-sm border border-red-500/50 bg-red-500/10 text-red-400">
                  <span className="font-semibold">Voided</span>
                  {selectedOrder.voidedByName ? ` by ${selectedOrder.voidedByName}` : ''} on{' '}
                  {formatDate(selectedOrder.voidedAt)}
                  {selectedOrder.voidReason ? ` — ${selectedOrder.voidReason}` : ''}. Not counted in sales,
                  takings or back orders.
                </div>
              )}
              {isWebOrder(selectedOrder) && (
                <div className="rounded-lg p-3 text-sm border border-blue-500/40 bg-blue-500/10 text-blue-300">
                  Website order {selectedOrder.magentoIncrementId ? `#${selectedOrder.magentoIncrementId} ` : ''}
                  — view only. Payments, refunds and changes are made in Magento. Lines can be put on
                  Back Order for purchasing.
                </div>
              )}

              {/* Customer details on the order (Sally, 15 Oct 2026: "name,
                  business name, address and phone number and email"). A
                  walk-in shows Link customer (16 Oct 2026). */}
              {(() => {
                const c = selectedOrder.customer;
                const name = c
                  ? [c.firstName, c.lastName].filter(Boolean).join(' ')
                  : selectedOrder.customerNameSnapshot;
                const address = c
                  ? [c.billingStreet, c.billingCity, c.billingState, c.billingPostcode].filter(Boolean).join(', ')
                  : '';
                return (
                  <div className="bg-pos-dark rounded-lg p-4 text-sm">
                    <p className="text-xs text-gray-400 uppercase mb-2">Customer</p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1">
                      <div>
                        <span className="text-gray-400">Name: </span>
                        <span className="font-semibold">{name || 'Walk-in'}</span>
                        {c?.isTrade && (
                          <span className="ml-2 px-1.5 py-0.5 rounded text-[10px] font-bold bg-orange-500/20 text-orange-300 border border-orange-500/40">
                            TRADE
                          </span>
                        )}
                      </div>
                      {c?.company && (
                        <div>
                          <span className="text-gray-400">Business: </span>
                          {c.company}
                        </div>
                      )}
                      {(c?.phone || c?.mobile) && (
                        <div>
                          <span className="text-gray-400">Phone: </span>
                          {formatPhone(c.phone || c.mobile)}
                        </div>
                      )}
                      {c?.email && (
                        <div>
                          <span className="text-gray-400">Email: </span>
                          <a href={`mailto:${c.email}`} className="text-primary-400 hover:underline">
                            {c.email}
                          </a>
                        </div>
                      )}
                      {address && (
                        <div className="md:col-span-2">
                          <span className="text-gray-400">Address: </span>
                          {address}
                        </div>
                      )}
                      {!c && isWebOrder(selectedOrder) && (
                        <div className="text-gray-400 md:col-span-2 whitespace-pre-wrap">
                          {(selectedOrder.internalNotes || '').split(/\r?\n/)[0] || 'Website guest checkout.'}
                        </div>
                      )}
                      {!c && !isLocked(selectedOrder) && (
                        <div className="md:col-span-2 flex flex-wrap items-center gap-3">
                          <span className="text-gray-500 italic">
                            Walk-in — no customer attached to this order.
                          </span>
                          <button
                            className="btn-secondary btn-sm flex items-center gap-1"
                            onClick={() => {
                              setLinkThen('order');
                              setLinkOrder(selectedOrder);
                              setLinkSearch('');
                              setLinkResults([]);
                            }}
                          >
                            <UserPlusIcon className="h-4 w-4" /> Link customer
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()}

              {/* Comments staff wrote on the order in Magento, newest first
                  (Sally, 26 Oct 2026: e.g. "B/O ETA late November"). */}
              {isWebOrder(selectedOrder) &&
                (() => {
                  const comments = (selectedOrder.events || [])
                    .filter((e: any) => e.type === 'magento_comment')
                    .sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
                  if (!comments.length) return null;
                  return (
                    <div className="bg-pos-dark rounded-lg p-4 border border-blue-500/40">
                      <p className="text-xs text-gray-400 uppercase mb-2">Comments from Magento</p>
                      <ul className="space-y-1.5 text-sm">
                        {comments.map((c: any) => (
                          <li key={c.id} className="flex justify-between gap-3">
                            <span className="whitespace-pre-wrap">{c.description}</span>
                            <span className="text-xs text-gray-400 whitespace-nowrap">{formatDate(c.createdAt)}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })()}

              <div className="bg-pos-dark rounded-lg p-4">
                <p className="text-xs text-gray-400 uppercase mb-2">
                  Items on this {selectedOrder.orderType === 'layby' ? 'Lay By' : 'Order'}
                </p>
                <table className="w-full text-sm">
                  <tbody>
                  {selectedOrder.items?.map((item: any) => {
                    const refundedQty = refundedQtyFor(selectedOrder, item.id);
                    const openBackorder = item.isBackorder && !item.backorderFulfilledAt;
                    const statusLocked =
                      selectedOrder.status === 'cancelled' ||
                      selectedOrder.status === 'refunded' ||
                      refundedQty >= item.quantity;
                    return (
                    <tr key={item.id} className="border-b border-gray-700 last:border-0">
                      <td className="py-1.5 pr-2">
                        <span className="font-medium">{item.quantity}× {item.name}</span>
                        <span className="text-xs text-gray-500 font-mono ml-1">{item.sku}</span>
                        {/* A line can carry several statuses at once
                            (Sally, 10 Sep, row 473). */}
                        {openBackorder && (
                          <span
                            className="ml-2 px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase bg-cyan-600/30 text-cyan-300 whitespace-nowrap"
                            title="Ordering from supplier"
                          >
                            Back Order{item.backorderQty ? ` ${item.backorderQty} of ${item.quantity}` : ''}
                          </span>
                        )}
                        {item.isBackorder && item.backorderFulfilledAt && (
                          <span className="ml-2 px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase bg-green-600/30 text-green-300 whitespace-nowrap">
                            Received
                          </span>
                        )}
                        {item.isLaybyHeld && (
                          <span
                            className="ml-2 px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase bg-amber-600/30 text-amber-300 whitespace-nowrap"
                            title="Held in store until the balance is paid"
                          >
                            Lay-by
                          </span>
                        )}
                        {refundedQty > 0 && (
                          <span className="ml-2 px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase bg-orange-600/30 text-orange-300 whitespace-nowrap">
                            {refundedQty >= item.quantity
                              ? 'Refunded'
                              : `Refunded ${refundedQty} of ${item.quantity}`}
                          </span>
                        )}
                        {!openBackorder &&
                          !item.isLaybyHeld &&
                          refundedQty < item.quantity &&
                          selectedOrder.paymentStatus === 'paid' && (
                            <span className="ml-2 px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase bg-green-600/30 text-green-300 whitespace-nowrap">
                              Paid
                            </span>
                          )}
                      </td>
                      <td className="py-1.5 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-2 justify-end">
                          {/* Status drop-down per line (Sally, 10 Sep, row 469). */}
                          {canRefund && !statusLocked && !isWebOrder(selectedOrder) && (
                            <select
                              className="input py-0.5 px-2 text-xs w-32"
                              value={lineStatusValue(item)}
                              disabled={itemStatusSaving === item.id}
                              title="Change this item's status"
                              onChange={(e) =>
                                handleSetItemStatus(
                                  selectedOrder,
                                  item,
                                  e.target.value as 'backorder' | 'layby' | 'paid',
                                )
                              }
                            >
                              <option value="backorder">Back Order</option>
                              <option value="layby">Lay-by</option>
                              {/* "Complete" = paid and taken (Sally, 20 Oct 2026). */}
                              <option value="paid">Complete (taken)</option>
                            </select>
                          )}
                          {webLineEditable(selectedOrder, item) && (
                            <span className="inline-flex items-center gap-1">
                              <input
                                type="number"
                                min={1}
                                max={item.quantity}
                                className="input py-0.5 px-2 text-xs w-14"
                                title="How many to order"
                                value={webQty[item.id] ?? String(item.backorderQty ?? item.quantity)}
                                disabled={itemStatusSaving === item.id}
                                onChange={(e) => {
                                  const v = e.target.value;
                                  setWebQty((m) => ({ ...m, [item.id]: v }));
                                }}
                              />
                              <button
                                type="button"
                                className="btn-secondary btn-sm"
                                disabled={itemStatusSaving === item.id}
                                title="Put this many on back order — it goes on Reports > Backorders"
                                onClick={() => handleWebLine(selectedOrder, item, 'backorder')}
                              >
                                Back Order
                              </button>
                              {openBackorder && (
                                <button
                                  type="button"
                                  className="btn-primary btn-sm bg-green-600 hover:bg-green-700"
                                  disabled={itemStatusSaving === item.id}
                                  title="Stock is in — take it off the back orders"
                                  onClick={() => handleWebLine(selectedOrder, item, 'complete')}
                                >
                                  Complete
                                </button>
                              )}
                            </span>
                          )}
                          <span className="font-medium">${parseFloat(item.rowTotal).toFixed(2)}</span>
                          {canManage && openBackorder && !isWebOrder(selectedOrder) && (
                            <button
                              onClick={() => handleFulfilBackorder(selectedOrder, [item.id])}
                              className="p-1.5 hover:bg-green-500/20 text-green-400 rounded"
                              title="Mark this backorder item as received (adjusts stock)"
                            >
                              <CheckCircleIcon className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                    );
                  })}
                  </tbody>
                </table>
                <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-gray-400 mt-2">
                  <span>
                    Customer:{' '}
                    <span className="text-gray-200 uppercase">
                      {selectedOrder.customer
                        ? `${selectedOrder.customer.firstName} ${selectedOrder.customer.lastName || ''}`.trim()
                        : selectedOrder.customerNameSnapshot || 'Walk-in'}
                    </span>
                  </span>
                  <span>
                    {isWebOrder(selectedOrder) ? (
                      <>Sold on: <span className="text-gray-200">Website</span></>
                    ) : (
                      <>
                        Cashier:{' '}
                        <span className="text-gray-200">
                          {selectedOrder.user?.firstName} {selectedOrder.user?.lastName}
                        </span>
                      </>
                    )}
                  </span>
                  {selectedOrder.laybyExpiresAt && (
                    <span>Lay By expires {formatDate(selectedOrder.laybyExpiresAt)}</span>
                  )}
                </div>
              </div>

              {/* Payment fields inline — laybys AND deposit-paid
                  backorders (Sally, 9 Sep: order 0067 had no way to
                  complete payment; 10 Sep: in the Balance Payment format). */}
              {canTakePayment(selectedOrder) && (
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Amount</label>
                    <input
                      type="number"
                      step="0.01"
                      min={0}
                      max={balanceDue(selectedOrder) || undefined}
                      className="input"
                      value={laybyPayAmount}
                      onChange={(e) => setLaybyPayAmount(e.target.value)}
                      disabled={isTakingLaybyPayment}
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
                          disabled={isTakingLaybyPayment}
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
                        disabled={isTakingLaybyPayment}
                      />
                    </div>
                  )}
                </div>
              )}

              {/* Action row, in the order Sally mocked up. Refund and
                  Refund Credits & Exchange both open the item-selection
                  screen (row 471). */}
              <div className="flex flex-wrap gap-3 justify-end">
                <button
                  className="btn-secondary"
                  onClick={closeOrder}
                  disabled={isTakingLaybyPayment}
                >
                  {isWebOrder(selectedOrder) ? 'Close' : 'Cancel'}
                </button>
                {!isLocked(selectedOrder) && (
                <button
                  className="btn-primary bg-green-600 hover:bg-green-700"
                  onClick={() => setEditItemsOrder(selectedOrder)}
                  disabled={isTakingLaybyPayment}
                  title="Add products to this order or change quantities"
                >
                  Add Lights
                </button>
                )}
                {/* Customer takes part of a back order / lay-by now — not
                    in Edit Items (Sally, 23 Oct 2026). */}
                {canRefund &&
                  !isLocked(selectedOrder) &&
                  !['cancelled', 'refunded'].includes(selectedOrder.status) &&
                  (selectedOrder.items || []).some(isOpenLine) && (
                    <button
                      className="btn-primary bg-indigo-600 hover:bg-indigo-700"
                      onClick={() => setCollectOrder(selectedOrder)}
                      disabled={isTakingLaybyPayment}
                      title="The customer is taking some of the back-order / lay-by items now"
                    >
                      Collect Items
                    </button>
                  )}
                {canRefund && !isLocked(selectedOrder) && (
                  <button
                    className="btn-primary bg-cyan-600 hover:bg-cyan-700"
                    onClick={() => openRefundModal(selectedOrder)}
                    disabled={isTakingLaybyPayment}
                    title="Pick the items to return, then exchange them"
                  >
                    Refund Credits &amp; Exchange
                  </button>
                )}
                {canRefund && !isLocked(selectedOrder) && (
                  <button
                    className="btn-primary bg-orange-600 hover:bg-orange-700"
                    onClick={() => openRefundModal(selectedOrder)}
                    disabled={isTakingLaybyPayment}
                    title="Pick the items to refund"
                  >
                    Refund
                  </button>
                )}
                {canTakePayment(selectedOrder) && (
                  <button
                    className="btn-primary bg-amber-600 hover:bg-amber-700"
                    onClick={handleRecordInlinePayment}
                    disabled={isTakingLaybyPayment}
                  >
                    {isTakingLaybyPayment ? 'Recording...' : 'Record Payment'}
                  </button>
                )}
                {canManage && selectedOrder.orderType === 'layby' && canTakePayment(selectedOrder) && (
                  <button
                    className="btn-secondary"
                    onClick={() => handleCancelLayby(selectedOrder)}
                    disabled={isTakingLaybyPayment}
                  >
                    Cancel Lay By
                  </button>
                )}
                {/* A lay-by that's paid in full with every item taken (Sally,
                    20 Oct 2026: POS-0117 stayed on LAY BY after collection). */}
                {['layby_active', 'layby_expired'].includes(selectedOrder.status) &&
                  !isLocked(selectedOrder) &&
                  balanceDue(selectedOrder) <= 0.005 &&
                  (selectedOrder.items || []).length > 0 &&
                  (selectedOrder.items || []).every(
                    (i: any) => !(i.isBackorder && !i.backorderFulfilledAt) && !i.isLaybyHeld,
                  ) && (
                    <button
                      className="btn-primary bg-green-600 hover:bg-green-700"
                      disabled={itemStatusSaving !== null}
                      title="Paid in full and every item taken — close the lay-by"
                      onClick={async () => {
                        const first = selectedOrder.items[0];
                        setItemStatusSaving(first.id);
                        try {
                          await ordersApi.setItemStatus(selectedOrder.id, first.id, 'paid');
                          await viewOrder(selectedOrder.id);
                          fetchOrders();
                          toast.success(`${selectedOrder.orderNumber} completed`);
                        } catch (err: any) {
                          toast.error(err?.response?.data?.message || 'Could not complete the order');
                        } finally {
                          setItemStatusSaving(null);
                        }
                      }}
                    >
                      Complete Order
                    </button>
                  )}
                {canVoid(selectedOrder) && (
                  <button
                    className="btn-secondary border border-red-500/60 text-red-400 hover:bg-red-500/10"
                    onClick={() => {
                      setVoidReason('');
                      setVoidFor(selectedOrder);
                    }}
                    disabled={isTakingLaybyPayment}
                    title="Admin: void a sale put through by mistake (e.g. twice) — it drops out of the reports"
                  >
                    Void Sale
                  </button>
                )}
              </div>

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
                {parseFloat(selectedOrder.deliveryFee || 0) > 0 && (
                  <div className="flex justify-between text-sm">
                    <span>Delivery</span>
                    <span>${parseFloat(selectedOrder.deliveryFee).toFixed(2)}</span>
                  </div>
                )}
                <div className="flex justify-between text-sm">
                  <span>Tax</span>
                  <span>${parseFloat(selectedOrder.taxAmount).toFixed(2)}</span>
                </div>
                <div className="flex justify-between font-bold text-lg mt-2">
                  <span>Order Total</span>
                  <span>${parseFloat(selectedOrder.grandTotal).toFixed(2)}</span>
                </div>
                {/* Deposit / balance reflection (Sally, 9 Sep: order 0067
                    "had a deposit taken and doesn't reflect this when
                    clicking on the order"). Shown whenever the order
                    isn't simply paid-in-full-and-done. */}
                {(selectedOrder.payments || []).length > 0 &&
                  balanceDue(selectedOrder) > 0.005 && (
                    <div className="mt-2 pt-2 border-t border-gray-700 space-y-1">
                      <div className="flex justify-between text-sm text-green-400">
                        <span>Paid to date</span>
                        <span>${paidTotal(selectedOrder).toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between font-semibold text-amber-300">
                        <span>Balance owing</span>
                        <span>${balanceDue(selectedOrder).toFixed(2)}</span>
                      </div>
                    </div>
                  )}
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

              {/* Payments taken on this order, with Change for managers
                  (Sally, 13 Oct 2026: "no way to make a change on the
                  payment" — EFTPOS declined, customer paid cash). */}
              {(selectedOrder.payments || []).length > 0 && (
                <div className="border-t border-gray-700 pt-4">
                  <p className="text-sm text-gray-400 mb-2">Payments</p>
                  <div className="space-y-2">
                    {(selectedOrder.payments || []).map((p: any) => (
                      <div key={p.id} className="flex flex-wrap items-center gap-2 text-sm bg-pos-dark rounded p-2">
                        <span className="text-gray-400 w-40">
                          {p.createdAt ? new Date(p.createdAt).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : ''}
                        </span>
                        {payEdit && payEdit.id === p.id ? (
                          <>
                            <select
                              className="input py-1 w-40"
                              value={payEdit.method}
                              onChange={(e) => {
                                const v = e.target.value;
                                setPayEdit((cur) => (cur ? { ...cur, method: v } : cur));
                              }}
                            >
                              <option value="cash">Cash</option>
                              <option value="eftpos">EFTPOS</option>
                              <option value="bank_transfer">Bank Transfer</option>
                            </select>
                            <input
                              className="input py-1 w-44"
                              placeholder="Reference (optional)"
                              value={payEdit.reference}
                              onChange={(e) => {
                                const v = e.target.value;
                                setPayEdit((cur) => (cur ? { ...cur, reference: v } : cur));
                              }}
                            />
                            <span className="ml-auto font-semibold">${Number(p.amount).toFixed(2)}</span>
                            <button
                              className="btn-primary btn-sm"
                              disabled={paySaving}
                              onClick={async () => {
                                const edit = payEdit;
                                if (!edit) return;
                                setPaySaving(true);
                                try {
                                  await ordersApi.changePaymentMethod(
                                    selectedOrder.id,
                                    p.id,
                                    edit.method,
                                    edit.reference,
                                  );
                                  toast.success(`Payment changed to ${payMethodLabel(edit.method)}`);
                                  setPayEdit(null);
                                  await viewOrder(selectedOrder.id);
                                } catch (err: any) {
                                  toast.error(err?.response?.data?.message || 'Could not change the payment');
                                } finally {
                                  setPaySaving(false);
                                }
                              }}
                            >
                              {paySaving ? 'Saving…' : 'Save'}
                            </button>
                            <button className="btn-secondary btn-sm" disabled={paySaving} onClick={() => setPayEdit(null)}>
                              Cancel
                            </button>
                          </>
                        ) : (
                          <>
                            <span className="font-semibold">{payMethodLabel(p.method)}</span>
                            {p.reference && <span className="text-xs text-gray-500">ref {p.reference}</span>}
                            {p.status && p.status !== 'completed' && (
                              <span className="text-xs text-amber-400">{p.status}</span>
                            )}
                            <span className="ml-auto font-semibold">${Number(p.amount).toFixed(2)}</span>
                            {canManage && p.method !== 'store_credit' && !isLocked(selectedOrder) && (
                              <button
                                className="text-xs text-primary-400 hover:underline"
                                onClick={() =>
                                  setPayEdit({
                                    id: p.id,
                                    method: ['cash', 'eftpos', 'bank_transfer'].includes(p.method) ? p.method : 'cash',
                                    reference: p.reference || '',
                                  })
                                }
                              >
                                Change
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Free-form staff notes (persist on order.notes). Cashiers
                  use this to jot follow-ups: pickup times, ETAs, restock
                  status. Edit-in-place; save button appears once a draft
                  is opened. */}
              <div className="border-t border-gray-700 pt-4">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm text-gray-400">
                    Customer note <span className="text-gray-600">(prints on invoice)</span>
                  </p>
                  {notesDraft === null && !isLocked(selectedOrder) && (
                    <button
                      onClick={() =>
                        setNotesDraft(selectedOrder.notes || '')
                      }
                      className="btn-secondary btn-sm"
                    >
                      {selectedOrder.notes ? 'Edit note' : '+ Add note'}
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
                      placeholder="Delivery instructions, pickup date… (prints on invoice)"
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

              {/* Internal note — staff-only, never printed (Sally, 26 Aug). */}
              <div className="border-t border-gray-700 pt-4">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm text-gray-400">
                    Internal note <span className="text-gray-600">(staff only — never printed)</span>
                  </p>
                  {internalNotesDraft === null && (
                    <button
                      onClick={() =>
                        setInternalNotesDraft(selectedOrder.internalNotes || '')
                      }
                      className="btn-secondary btn-sm"
                    >
                      {selectedOrder.internalNotes ? 'Edit note' : '+ Add note'}
                    </button>
                  )}
                </div>
                {internalNotesDraft === null ? (
                  <p className="text-sm text-gray-300 whitespace-pre-wrap">
                    {selectedOrder.internalNotes || (
                      <span className="text-gray-500 italic">
                        No internal note on this order.
                      </span>
                    )}
                  </p>
                ) : (
                  <div>
                    <textarea
                      value={internalNotesDraft}
                      onChange={(e) => setInternalNotesDraft(e.target.value)}
                      className="input w-full text-sm"
                      rows={3}
                      placeholder="Supplier ETA, chase-ups, anything the customer shouldn't see…"
                      autoFocus
                    />
                    <div className="flex justify-end gap-2 mt-2">
                      <button
                        onClick={() => setInternalNotesDraft(null)}
                        className="btn-secondary text-xs"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={saveInternalNotes}
                        disabled={savingNotes}
                        className="btn-primary text-xs disabled:opacity-50"
                      >
                        {savingNotes ? 'Saving…' : 'Save'}
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Order History — shared timeline component (also shown
                  in the Refund/Edit modal, which is how Sally opens
                  orders). Payments, refunds, exchanges, fulfilments and
                  item edits, newest first. */}
              <div className="border-t border-gray-700 pt-4">
                <OrderHistoryTimeline
                  order={selectedOrder}
                  refunds={selectedOrder.refunds || []}
                />
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
                <h2 className="text-xl font-bold">
                  {(laybyPayOrder as any).orderType === 'layby'
                    ? 'Lay By Payment'
                    : 'Balance Payment'}
                </h2>
                <p className="text-sm text-gray-400">{laybyPayOrder.orderNumber}</p>
              </div>
            </div>

            {laybyBalance && (
              <div className="bg-pos-dark rounded-lg p-4 mb-4 grid grid-cols-3 gap-3 text-center">
                <div>
                  <p className="text-xs text-gray-400">Order Total</p>
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
              <div className="flex items-center gap-3">
                {/* PAY — this screen is how Sally opens orders, so the
                    balance-collection entry point lives here too. */}
                {canTakePayment(refundOrder) && (
                  <button
                    className="btn-primary bg-amber-600 hover:bg-amber-700 flex items-center gap-2 text-sm"
                    onClick={() => {
                      const o = refundOrder;
                      setRefundOrder(null);
                      openLaybyPay(o);
                    }}
                    disabled={isProcessingRefund}
                    title="Take the balance payment on this order"
                  >
                    <BanknotesIcon className="h-4 w-4" /> PAY
                  </button>
                )}
                <div className="text-right">
                  {/* The order's real status up top (Sally, 9 Sep: the
                      header read "Refund" on a completed order — it must
                      say Complete / Back Order / Partial Refund etc). */}
                  <div className="flex items-center justify-end gap-2">
                    {getStatusBadge(
                      refundOrder.status,
                      (refundOrder.exchangedToOrders || []).length > 0,
                    )}
                    <h2 className="text-xl font-bold">Order {refundOrder.orderNumber}</h2>
                  </div>
                  <p className="text-sm text-gray-400">Select items and quantities to refund</p>
                </div>
              </div>
            </div>

            {/* Credit destination banner removed per client request —
                the "Refund method" toggle above already shows where the
                refund goes. */}

            {/* Items — same list style and status badges as the order
                screen (Sally, 10 Sep, row 471), plus the refund controls. */}
            <div className="mb-6">
              <p className="text-xs text-gray-400 uppercase mb-2">
                Items on this {refundOrder.orderType === 'layby' ? 'Lay By' : 'Order'}
              </p>
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
                        <span className="font-medium">{item.originalQty}× {item.name}</span>
                        <span className="text-xs text-gray-500 font-mono ml-1">{item.sku}</span>
                        {item.isBackorder && !item.backorderFulfilledAt && (
                          <span className="ml-2 px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase bg-cyan-600/30 text-cyan-300 whitespace-nowrap">
                            Back Order
                          </span>
                        )}
                        {item.isBackorder && item.backorderFulfilledAt && (
                          <span className="ml-2 px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase bg-green-600/30 text-green-300 whitespace-nowrap">
                            Received
                          </span>
                        )}
                        {item.isLaybyHeld && (
                          <span className="ml-2 px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase bg-amber-600/30 text-amber-300 whitespace-nowrap">
                            Lay-by
                          </span>
                        )}
                        {item.originalQty - item.remainingQty > 0 && (
                          <span className="ml-2 px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase bg-orange-600/30 text-orange-300 whitespace-nowrap">
                            {item.remainingQty === 0
                              ? 'Refunded'
                              : `Refunded ${item.originalQty - item.remainingQty} of ${item.originalQty}`}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-center">{item.remainingQty}</td>
                      <td className="px-3 py-2">
                        <input
                          type="number"
                          min={0}
                          max={item.remainingQty}
                          value={item.quantity}
                          disabled={item.remainingQty === 0}
                          onChange={(e) => {
                            const val = Math.max(
                              0,
                              Math.min(item.remainingQty, parseInt(e.target.value) || 0),
                            );
                            // Typing a quantity ticks the line; back to 0 unticks it.
                            updateRefundItem(idx, { quantity: val, selected: val > 0 });
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
              <p className="text-xs text-gray-400 mt-2">
                Customer:{' '}
                <span className="text-gray-200 uppercase">
                  {refundOrder.customer
                    ? `${refundOrder.customer.firstName} ${refundOrder.customer.lastName || ''}`.trim()
                    : refundOrder.customerNameSnapshot || 'Walk-in'}
                </span>
              </p>
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
                      setLinkThen('refund');
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
                {/* No Add Lights on the refund screen (Sally, 20 Oct 2026:
                    staff thought they could add a light here instead of
                    carrying on with Refund Credits & Exchange). It stays on
                    the order screen itself. */}
                {/* Exchange: return to store credit + go to POS to ring
                    the replacement (needs a linked customer). Guards run
                    ON CLICK with a toast saying why — a silently
                    disabled button reads as "broken" (Sally, 9 Sep). */}
                <button
                  className="btn-primary bg-cyan-600 hover:bg-cyan-700"
                  onClick={() => {
                    if (refundTotal === 0) {
                      toast.error(
                        'Tick at least one item above first — the exchange needs items to return',
                      );
                      return;
                    }
                    if (!refundOrder.customer) {
                      toast.error(
                        'Link a customer first — an exchange parks the value as store credit on their account',
                      );
                      return;
                    }
                    processRefund(true);
                  }}
                  disabled={isProcessingRefund}
                  title="Return to store credit and ring the replacement"
                >
                  {refundAsCash ? 'Refund & Exchange' : 'Refund Credits & Exchange'}
                </button>
                <button
                  className="btn-primary bg-orange-600 hover:bg-orange-700"
                  onClick={() => {
                    if (refundTotal === 0) {
                      toast.error('Tick at least one item above to refund first');
                      return;
                    }
                    processRefund(false);
                  }}
                  disabled={isProcessingRefund}
                >
                  {/* Sally, 25 Aug: orange button reads just "Refund" */}
                  {isProcessingRefund ? 'Processing...' : 'Refund'}
                </button>
              </div>
            </div>

            {/* Order History (Sally, 9 Sep) — refunds, exchanges,
                payments and item edits, right where she opens orders. */}
            <div className="border-t border-gray-700 pt-4 mt-6">
              <OrderHistoryTimeline
                order={refundOrder}
                refunds={refundOrder.refunds || []}
              />
            </div>
            </div>
          </div>
        </div>
      )}

      {/* Void confirmation (admin). */}
      {voidFor && (
        <div className="modal-backdrop-top">
          <div className="modal-content max-w-lg m-auto">
            <h3 className="text-lg font-bold mb-2">Void {voidFor.orderNumber}?</h3>
            <div className="text-sm text-gray-400 space-y-2 mb-4">
              <p>
                For a sale put through by mistake, e.g. twice. The sale is cancelled and left out of the sales
                reports, End of Day takings and back orders, and its stock goes back on the shelf. It is not
                recorded as a refund.
              </p>
              {paidTotal(voidFor) > 0.005 && (
                <p className="text-amber-500">
                  ${paidTotal(voidFor).toFixed(2)} was taken on this sale. The POS doesn't refund it — if the customer
                  was really charged, reverse it on the EFTPOS terminal or give the cash back.
                </p>
              )}
            </div>
            <label className="block text-xs text-gray-400 mb-1">Reason (required)</label>
            <input
              className="input w-full mb-4"
              value={voidReason}
              maxLength={300}
              placeholder="e.g. Duplicate of POS-0218"
              autoFocus
              onChange={(e) => setVoidReason(e.target.value)}
            />
            <div className="flex justify-end gap-3">
              <button className="btn-secondary" onClick={() => setVoidFor(null)} disabled={voiding}>
                Keep sale
              </button>
              <button className="btn-primary bg-red-600 hover:bg-red-700" onClick={handleVoid} disabled={voiding}>
                {voiding ? 'Voiding…' : 'Void sale'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Customer ticket preview at true size, then print (one label). */}
      {ticketFor && (() => {
        const t = ticketData(ticketFor);
        const noCustomer = !ticketFor.customer && !isWebOrder(ticketFor);
        return (
          <div className="modal-backdrop-top">
            <div className="m-auto flex flex-col items-center gap-4">
              <div className="shadow-lg" dangerouslySetInnerHTML={{ __html: customerTicketHtml(t) }} />
              <p className="text-xs text-gray-400">Actual size: 89mm wide × 36mm high</p>
              {noCustomer && (
                <div className="flex items-center gap-3 text-sm text-amber-300">
                  <span>No customer on this order — link one to print their name and phone.</span>
                  <button
                    className="btn-secondary btn-sm flex items-center gap-1"
                    onClick={() => {
                      setLinkThen('ticket');
                      setLinkOrder(ticketFor);
                      setLinkSearch('');
                      setLinkResults([]);
                      setTicketFor(null);
                    }}
                  >
                    <UserPlusIcon className="h-4 w-4" /> Link customer
                  </button>
                </div>
              )}
              <div className="flex gap-3 w-64">
                <button className="btn-secondary flex-1" onClick={() => setTicketFor(null)}>
                  Close
                </button>
                <button
                  className="btn-primary flex-1 flex items-center justify-center gap-2"
                  onClick={() => printTicketHtml(t.orderNumber, customerTicketHtml(t))}
                >
                  <PrinterIcon className="h-5 w-5" />
                  Print
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Link Customer modal — walk-in orders (refund, or the order's Customer card) */}
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
                  {linkThen === 'refund'
                    ? `${linkOrder.orderNumber} is a walk-in order. Attach a customer so store credit can be issued on refund.`
                    : `${linkOrder.orderNumber} is a walk-in order. Attach the customer so their name and phone show on the order and its ticket.`}
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
                      {c.phone ? ` | ${formatPhone(c.phone)}` : ''}
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
                {(laybyReceipt.order as any).orderType === 'layby'
                  ? laybyReceipt.isFinal
                    ? 'LAY BY FINAL PAYMENT'
                    : 'LAY BY PAYMENT RECEIPT'
                  : laybyReceipt.isFinal
                    ? 'FINAL PAYMENT'
                    : 'PAYMENT RECEIPT'}
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
                  {(laybyReceipt.order as any).orderType === 'layby'
                    ? 'Lay By paid in full — goods may be released to the customer.'
                    : 'Order paid in full.'}
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
              {/* Customer details on the refund template (Sally, 9 Sep). */}
              {(() => {
                const c = completedRefund.order.customer;
                const name = c
                  ? [c.firstName, c.lastName].filter(Boolean).join(' ')
                  : completedRefund.order.customerNameSnapshot || 'Walk-in';
                const addr = c
                  ? [c.billingStreet, c.billingCity, c.billingState, c.billingPostcode]
                      .filter(Boolean)
                      .join(', ')
                  : '';
                return (
                  <>
                    <div className="flex justify-between">
                      <span>Customer:</span>
                      <span className="font-medium">{name}</span>
                    </div>
                    {c?.companyName && (
                      <div className="flex justify-between">
                        <span>Company:</span>
                        <span>{c.companyName}</span>
                      </div>
                    )}
                    {(c?.phone || c?.mobile) && (
                      <div className="flex justify-between">
                        <span>Phone:</span>
                        <span>{formatPhone(c.phone || c.mobile)}</span>
                      </div>
                    )}
                    {c?.email && (
                      <div className="flex justify-between">
                        <span>Email:</span>
                        <span>{c.email}</span>
                      </div>
                    )}
                    {addr && (
                      <div className="flex justify-between gap-4">
                        <span>Address:</span>
                        <span className="text-right">{addr}</span>
                      </div>
                    )}
                  </>
                );
              })()}
              <div className="flex justify-between">
                <span>Refund Date:</span>
                <span>{formatDate(completedRefund.refund.createdAt)}</span>
              </div>
              <div className="flex justify-between">
                <span>Processed by:</span>
                <span>
                  {completedRefund.refund.user
                    ? [completedRefund.refund.user.firstName, completedRefund.refund.user.lastName].filter(Boolean).join(' ')
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
