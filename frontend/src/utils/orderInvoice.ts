// Build the InvoiceModal's `invoice` payload from a fetched order
// (ordersApi.getOrder(...).data.data.order). Shared by the POS "Last
// Invoice" button and the Customers page re-print so the mapping lives
// in one place.
//
// `refunds` (ordersApi.getRefunds(...).data.data.refunds) is optional;
// when supplied, refunded quantities are marked per line and the totals
// block shows the refunded amount — a reprint after a partial refund
// must not read like the original untouched sale.
export function buildInvoiceData(o: any, fallbackCustomer?: any, refunds?: any[]) {
  const cust = o.customer || fallbackCustomer || null;
  const addr = cust
    ? [
        cust.billingStreet,
        cust.billingCity,
        cust.billingState,
        cust.billingPostcode,
      ]
        .filter(Boolean)
        .join(', ')
    : '';
  // qty refunded per order_item id, across every refund on the order
  const refundedQtyByItem: Record<number, number> = {};
  let totalRefunded = 0;
  for (const r of refunds || []) {
    totalRefunded += Number(r.refundAmount || 0);
    for (const ri of r.items || []) {
      refundedQtyByItem[ri.orderItemId] =
        (refundedQtyByItem[ri.orderItemId] || 0) + Number(ri.quantity || 0);
    }
  }
  const items = (o.items || []).map((it: any) => ({
    productId: it.productId ?? 0,
    sku: it.sku || '',
    name: it.name || it.productName || '',
    quantity: it.quantity,
    unitPrice: parseFloat(it.unitPrice),
    discountPercent: parseFloat(it.discountPercent || 0),
    discountAmount: parseFloat(it.discountAmount || 0),
    taxAmount: parseFloat(it.taxAmount || 0),
    rowTotal: parseFloat(it.rowTotal ?? it.unitPrice * it.quantity),
    isBackorder: !!it.isBackorder,
    isLaybyHeld: !!it.isLaybyHeld,
    refundedQty: refundedQtyByItem[it.id] || 0,
  }));
  const firstPayment = (o.payments || [])[0];
  // Store credit consumed by this order — shown as CREDIT APPLIED and
  // subtracted from the printed BALANCE (a credit-covered exchange must
  // print $0.00, not re-bill the replacement).
  const creditApplied = (o.payments || [])
    .filter((p: any) => p.method === 'store_credit')
    .reduce((s: number, p: any) => s + Number(p.amount || 0), 0);
  const userName = o.user
    ? [o.user.firstName, o.user.lastName].filter(Boolean).join(' ').trim() ||
      o.user.username
    : undefined;
  return {
    orderNumber: o.orderNumber,
    date: o.createdAt,
    updatedAt: o.updatedAt,
    buyerType: cust?.isTrade ? 'retail' : 'customer',
    customerName: cust
      ? [cust.firstName, cust.lastName].filter(Boolean).join(' ')
      : undefined,
    customerCompany: cust?.companyName || cust?.company || undefined,
    customerEmail: cust?.email || undefined,
    customerPhone: cust?.phone || cust?.mobile || undefined,
    customerAddress: addr || undefined,
    items,
    subtotal: parseFloat(o.subtotal),
    itemDiscounts: parseFloat(o.discountAmount || 0),
    cartDiscount: 0,
    taxAmount: parseFloat(o.taxAmount || 0),
    grandTotal: parseFloat(o.grandTotal),
    // Re-prints of orders that included a delivery fee should show the
    // freight row on the invoice, same as the original print did.
    deliveryFee: o.deliveryFee != null ? parseFloat(o.deliveryFee) : 0,
    deliveryType: o.deliveryType || undefined,
    paymentMethod: firstPayment?.method || 'eftpos',
    salesPerson: userName,
    notes: o.notes || undefined,
    totalRefunded: totalRefunded > 0 ? Math.round(totalRefunded * 100) / 100 : undefined,
    creditApplied:
      creditApplied > 0 ? Math.round(creditApplied * 100) / 100 : undefined,
    // Present when the order detail endpoint attached exchange links
    // (this sale replaced goods returned on an earlier order).
    exchangeFromOrderNumber: o.exchangeFromOrder?.orderNumber || undefined,
  };
}
