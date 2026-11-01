// Build the InvoiceModal's `invoice` payload from a fetched order
// (ordersApi.getOrder(...).data.data.order). Shared by the POS "Last
// Invoice" button and the Customers page re-print so the mapping lives
// in one place.
//
// `refunds` (ordersApi.getRefunds(...).data.data.refunds) is optional;
// when supplied, refunded quantities are marked per line and the totals
// block shows the refunded amount — a reprint after a partial refund
// must not read like the original untouched sale.
// exchangeRefund: the refund on the ORIGINAL order that this sale replaced
// (an exchange); its items print as RETURNED on this invoice.
export function returnedFromRefund(refund: any) {
  const items = (refund?.items || []).filter((ri: any) => Number(ri.quantity) > 0);
  if (!items.length) return undefined;
  return items.map((ri: any) => ({
    qty: Number(ri.quantity),
    name: ri.name || ri.sku || 'Returned item',
    sku: ri.sku || undefined,
    amount: Math.round(Number(ri.amount || 0) * 100) / 100,
  }));
}

export function buildInvoiceData(o: any, fallbackCustomer?: any, refunds?: any[], exchangeRefund?: any) {
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
  const lines = (o.items || []).map((it: any) => {
    // A back order that has arrived prints as taken.
    const openBackorder = !!it.isBackorder && !it.backorderFulfilledAt;
    return {
      productId: it.productId ?? 0,
      sku: it.sku || '',
      name: it.name || it.productName || '',
      quantity: Number(it.quantity),
      unitPrice: parseFloat(it.unitPrice),
      discountPercent: parseFloat(it.discountPercent || 0),
      discountAmount: parseFloat(it.discountAmount || 0),
      // "Black Friday" when the promotion gave this line its discount.
      promoName: it.promoLabel || null,
      taxAmount: parseFloat(it.taxAmount || 0),
      rowTotal: parseFloat(it.rowTotal ?? it.unitPrice * it.quantity),
      isBackorder: openBackorder,
      // How many of the line are on back order (website orders can be
      // part of a line).
      backorderQty: openBackorder ? Math.min(Number(it.quantity), Number(it.backorderQty ?? it.quantity)) : 0,
      isLaybyHeld: !!it.isLaybyHeld,
      laybyHeldQty: it.isLaybyHeld ? Number(it.quantity) : 0,
      refundedQty: refundedQtyByItem[it.id] || 0,
    };
  });
  // One line per product: a sale split into take-now + back order (or
  // lay-by) parts prints as the single line the customer bought, e.g. 4 x
  // with 2 taken / 2 on back order — not two lines of 2 (Sally, 20 Oct
  // 2026, POS-0168). Only identical product, name, price and discount merge.
  const merged = new Map<string, any>();
  for (const l of lines) {
    const key = [l.productId || '', l.sku, l.name, l.unitPrice.toFixed(4), l.discountPercent.toFixed(4)].join('|');
    const m = merged.get(key);
    if (!m) {
      merged.set(key, { ...l });
      continue;
    }
    m.quantity += l.quantity;
    m.rowTotal += l.rowTotal;
    m.discountAmount += l.discountAmount;
    m.taxAmount += l.taxAmount;
    m.backorderQty += l.backorderQty;
    m.laybyHeldQty += l.laybyHeldQty;
    m.refundedQty += l.refundedQty;
    m.isBackorder = m.isBackorder || l.isBackorder;
    m.isLaybyHeld = m.isLaybyHeld || l.isLaybyHeld;
  }
  const items = [...merged.values()].map((m) => ({
    ...m,
    rowTotal: Math.round(m.rowTotal * 100) / 100,
    backorderQty: m.isBackorder ? m.backorderQty : undefined,
    laybyHeldQty: m.isLaybyHeld ? m.laybyHeldQty : undefined,
  }));
  // Website orders carry no POS payment rows — Magento took the money.
  // Paid on the website prints as one WEBSITE payment (view-only orders,
  // Sally 16 Oct 2026).
  const isWeb = o.source === 'magento';
  if (isWeb && !(o.payments || []).length && ['paid', 'refunded'].includes(o.paymentStatus)) {
    o = { ...o, payments: [{ method: 'website', amount: parseFloat(o.grandTotal), createdAt: o.createdAt }] };
  }
  const firstPayment = (o.payments || [])[0];
  // Store credit consumed by this order — shown as CREDIT APPLIED and
  // subtracted from the printed BALANCE (a credit-covered exchange must
  // print $0.00, not re-bill the replacement).
  const creditApplied = (o.payments || [])
    .filter((p: any) => p.method === 'store_credit')
    .reduce((s: number, p: any) => s + Number(p.amount || 0), 0);
  // Money actually taken (cash/EFTPOS/transfer). A layby/backorder
  // reprint must show DEPOSIT + the true BALANCE owing, not re-bill the
  // whole order ("the invoice doesn't tell how much the customer owes").
  const paidNonCredit = (o.payments || [])
    .filter((p: any) => p.method !== 'store_credit')
    .reduce((s: number, p: any) => s + Number(p.amount || 0), 0);
  const grandTotalNum = parseFloat(o.grandTotal);
  const takeNowSubtotal = (o.items || [])
    .filter((it: any) => !(it.isBackorder && !it.backorderFulfilledAt) && !it.isLaybyHeld)
    .reduce((s: number, it: any) => s + Number(it.rowTotal || 0), 0);
  const hasDeferred = (o.items || []).some(
    (it: any) => (it.isBackorder && !it.backorderFulfilledAt) || it.isLaybyHeld,
  );
  const userName = o.user
    ? [o.user.firstName, o.user.lastName].filter(Boolean).join(' ').trim() ||
      o.user.username
    : undefined;
  return {
    orderNumber: o.orderNumber,
    // Voided sale (duplicate) — the reprint says so.
    voided: !!o.voidedAt,
    date: o.createdAt,
    updatedAt: o.updatedAt,
    buyerType: cust?.isTrade ? 'retail' : 'customer',
    customerName: cust
      ? [cust.firstName, cust.lastName].filter(Boolean).join(' ')
      : o.customerNameSnapshot || undefined,
    customerCompany: cust?.companyName || cust?.company || undefined,
    customerEmail: cust?.email || undefined,
    customerPhone: cust?.phone || cust?.mobile || undefined,
    customerAddress: addr || undefined,
    items,
    subtotal: parseFloat(o.subtotal),
    // Line discounts are already in the line totals; the "Apply Further
    // Discount" part prints as its own DISCOUNT row (Sally, 23 Oct 2026).
    itemDiscounts: Math.round(lines.reduce((s: number, l: any) => s + l.discountAmount, 0) * 100) / 100,
    cartDiscount: Number(o.cartDiscount?.amount || 0),
    taxAmount: parseFloat(o.taxAmount || 0),
    grandTotal: parseFloat(o.grandTotal),
    // Re-prints of orders that included a delivery fee should show the
    // freight row on the invoice, same as the original print did.
    deliveryFee: o.deliveryFee != null ? parseFloat(o.deliveryFee) : 0,
    deliveryType: o.deliveryType || undefined,
    paymentMethod: firstPayment?.method || 'eftpos',
    salesPerson: isWeb ? 'Website' : userName,
    notes: o.notes || undefined,
    totalRefunded: totalRefunded > 0 ? Math.round(totalRefunded * 100) / 100 : undefined,
    creditApplied:
      creditApplied > 0 ? Math.round(creditApplied * 100) / 100 : undefined,
    // Present when the order detail endpoint attached exchange links
    // (this sale replaced goods returned on an earlier order).
    exchangeFromOrderNumber: o.exchangeFromOrder?.orderNumber || undefined,
    returnedItems: returnedFromRefund(exchangeRefund),
    // Always present (Sally, 7 Sep: a paid-in-full reprint must show
    // PAID + BALANCE $0.00, not re-bill the total). balanceDue is
    // pre-credit — InvoiceModal subtracts creditApplied.
    // Every money-in event so the invoice can print the deposit AND the
    // later balance payment(s) as separate lines (Sally, 9 Sep: "invoice
    // template to reflect the second payment").
    payments: (o.payments || []).map((p: any) => ({
      method: p.method,
      amount: Number(p.amount || 0),
      date: p.createdAt,
    })),
    amountPaid: Math.round(paidNonCredit * 100) / 100,
    balanceDue: Math.max(
      0,
      Math.round((grandTotalNum - paidNonCredit) * 100) / 100,
    ),
    isLayby: (o.items || []).some((it: any) => it.isLaybyHeld) || o.orderType === 'layby',
    isBackorder: (o.items || []).some((it: any) => it.isBackorder && !it.backorderFulfilledAt),
    takeNowSubtotal: hasDeferred
      ? Math.round(takeNowSubtotal * 100) / 100
      : undefined,
  };
}
