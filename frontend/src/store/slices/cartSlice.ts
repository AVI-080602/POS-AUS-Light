import { createSlice, PayloadAction } from '@reduxjs/toolkit';

export interface CartItem {
  productId: number;
  sku: string;
  name: string;
  quantity: number;
  unitPrice: number;
  // What the cashier typed (manual override). Effective discount is
  // max(discountPercent, autoDiscountPercent) — see recalculateTotals.
  discountPercent: number;
  // Trade auto-discount fetched from the server when the selected
  // customer has isTrade=true. 0 when there's no trade customer or no
  // rule matches. The label is shown on the cart line for transparency.
  autoDiscountPercent?: number;
  autoDiscountLabel?: string | null;
  discountAmount: number;
  taxAmount: number;
  rowTotal: number;
  imageUrl?: string;
  isSaleItem?: boolean;
  // Cashier changed the actual unit price (tag button / price click).
  // Sent to the backend so the edited price is honoured at order time.
  priceEdited?: boolean;
  // What a walk-in would pay right now (sale price when active, else
  // retail) and the fixed retail the trade % is based on. Captured at
  // add-to-cart time so the customer-price-wins rule can re-derive the
  // right base whenever the trade discounts land: if trade base × (1 −
  // trade %) is still dearer than the customer price, the customer
  // price is charged instead (Sally row 367).
  retailSalePrice?: number;
  tradeBasePrice?: number;
  // Item was out of stock when it was added to cart. PaymentModal uses
  // this to default the "Backorder" checkbox to on, and — combined with
  // the manual toggle — this is what gets submitted as `isBackorder` on
  // the order item.
  isBackorder?: boolean;
}

export interface CartDiscount {
  type: 'percent' | 'fixed';
  value: number;
  reason?: string;
}

interface CartState {
  items: CartItem[];
  customerId: number | null;
  customerName: string | null;
  // Mirrors customer.isTrade. When true, POSPage fetches the trade
  // auto-discount per line and stores it on each CartItem. Cart math
  // then uses max(manual, auto) per line.
  customerIsTrade: boolean;
  // Exchange context — set when this sale is the replacement half of an
  // exchange. The resulting order links back to the original.
  exchangeFromOrderId: number | null;
  exchangeFromOrderNumber: string | null;
  // Quote-conversion context — set when the cart was loaded from an open
  // quote. Quoted prices are locked (server told to trust them, trade
  // auto-discounts suppressed) and the quote is marked CONVERTED once
  // the order completes.
  fromQuoteId: number | null;
  fromQuoteNumber: string | null;
  cartDiscount: CartDiscount | null;
  subtotal: number;
  itemDiscounts: number;
  cartDiscountAmount: number;
  taxAmount: number;
  grandTotal: number;
  notes: string;
  // Delivery method + fee picked in PaymentModal — mirrored here so the
  // cart sidebar can show a matching total. PaymentModal dispatches
  // setDelivery whenever the cashier flips the dropdown. Cleared on
  // clearCart.
  deliveryType: 'pickup' | 'delivery' | 'local_metro' | 'austpost';
  deliveryFee: number;
}

const initialState: CartState = {
  items: [],
  customerId: null,
  customerName: null,
  customerIsTrade: false,
  exchangeFromOrderId: null,
  exchangeFromOrderNumber: null,
  fromQuoteId: null,
  fromQuoteNumber: null,
  cartDiscount: null,
  subtotal: 0,
  itemDiscounts: 0,
  cartDiscountAmount: 0,
  taxAmount: 0,
  grandTotal: 0,
  notes: '',
  deliveryType: 'pickup',
  deliveryFee: 0,
};

// Australian prices are GST-inclusive. GST = price / 11 (i.e. 1/11th of the inclusive price).
const GST_DIVISOR = 11;

function recalculateTotals(state: CartState): void {
  // Calculate item totals (all prices are GST-inclusive)
  let subtotal = 0;
  let itemDiscounts = 0;
  // Clearance / sale items are already marked down — they must be
  // excluded from the cart-level "Further discount" base, so we track
  // the discountable (non-sale) portion separately.
  let discountableBase = 0;

  state.items.forEach((item) => {
    const lineSubtotal = item.unitPrice * item.quantity;
    const effectivePercent = Math.max(
      item.discountPercent || 0,
      item.autoDiscountPercent || 0,
    );
    const discount = lineSubtotal * (effectivePercent / 100);
    const afterDiscount = lineSubtotal - discount;
    // GST is included in the price, extract it: GST = inclusive / 11
    const tax = afterDiscount / GST_DIVISOR;

    item.discountAmount = Math.round(discount * 100) / 100;
    item.taxAmount = Math.round(tax * 100) / 100;
    // rowTotal = afterDiscount (price already includes GST)
    item.rowTotal = Math.round(afterDiscount * 100) / 100;

    subtotal += lineSubtotal;
    itemDiscounts += discount;
    if (!item.isSaleItem) discountableBase += afterDiscount;
  });

  state.subtotal = Math.round(subtotal * 100) / 100;
  state.itemDiscounts = Math.round(itemDiscounts * 100) / 100;

  // Calculate cart discount — only against the non-clearance portion.
  let cartDiscountAmount = 0;

  if (state.cartDiscount && state.cartDiscount.value > 0) {
    if (state.cartDiscount.type === 'percent') {
      cartDiscountAmount = discountableBase * (state.cartDiscount.value / 100);
    } else {
      cartDiscountAmount = Math.min(state.cartDiscount.value, discountableBase);
    }
  }

  state.cartDiscountAmount = Math.round(cartDiscountAmount * 100) / 100;

  // Grand total = after all discounts (GST already included in prices)
  const afterAllDiscounts = subtotal - itemDiscounts - cartDiscountAmount;
  // Extract GST component for display
  state.taxAmount = Math.round(afterAllDiscounts / GST_DIVISOR * 100) / 100;
  state.grandTotal = Math.round(afterAllDiscounts * 100) / 100;
}

const cartSlice = createSlice({
  name: 'cart',
  initialState,
  reducers: {
    addItem: (
      state,
      action: PayloadAction<{
        productId: number;
        sku: string;
        name: string;
        price: number;
        imageUrl?: string;
        isSaleItem?: boolean;
        isBackorder?: boolean;
        // Sale-aware customer price + fixed retail trade base — feed the
        // customer-price-wins rule (see CartItem comments).
        retailSalePrice?: number;
        tradeBasePrice?: number;
      }>
    ) => {
      const {
        productId,
        sku,
        name,
        price,
        imageUrl,
        isSaleItem,
        isBackorder,
        retailSalePrice,
        tradeBasePrice,
      } = action.payload;

      const existingItem = state.items.find((i) => i.productId === productId);

      if (existingItem) {
        existingItem.quantity += 1;
        // If we're adding a backorder copy of an item, upgrade the flag so
        // the cashier sees it tagged even if the first add was in-stock.
        if (isBackorder) existingItem.isBackorder = true;
        if (retailSalePrice != null) existingItem.retailSalePrice = retailSalePrice;
        if (tradeBasePrice != null) existingItem.tradeBasePrice = tradeBasePrice;
      } else {
        state.items.push({
          productId,
          sku,
          name,
          quantity: 1,
          unitPrice: price,
          discountPercent: 0,
          discountAmount: 0,
          taxAmount: 0,
          rowTotal: 0,
          imageUrl,
          isSaleItem,
          isBackorder,
          retailSalePrice,
          tradeBasePrice,
        });
      }

      recalculateTotals(state);
    },

    removeItem: (state, action: PayloadAction<number>) => {
      state.items = state.items.filter((i) => i.productId !== action.payload);
      recalculateTotals(state);
    },

    updateQuantity: (
      state,
      action: PayloadAction<{ productId: number; quantity: number }>
    ) => {
      const { productId, quantity } = action.payload;
      const item = state.items.find((i) => i.productId === productId);

      if (item) {
        if (quantity <= 0) {
          state.items = state.items.filter((i) => i.productId !== productId);
        } else {
          item.quantity = quantity;
        }
      }

      recalculateTotals(state);
    },

    setItemDiscount: (
      state,
      action: PayloadAction<{ productId: number; discountPercent: number }>
    ) => {
      const { productId, discountPercent } = action.payload;
      const item = state.items.find((i) => i.productId === productId);

      if (item) {
        item.discountPercent = Math.max(0, Math.min(100, discountPercent));
      }

      recalculateTotals(state);
    },

    // Allow the cashier to change the actual unit price on any cart
    // line — including SALE / clearance items (Sally row 358: "change
    // this red discount to staff changing the actual price"). The
    // priceEdited flag tells the backend to honour the sent price
    // instead of re-pricing from the catalogue; the cost+30% floor
    // still guards it server-side (hard block for sales staff).
    setItemUnitPrice: (
      state,
      action: PayloadAction<{ productId: number; unitPrice: number }>,
    ) => {
      const { productId, unitPrice } = action.payload;
      const item = state.items.find((i) => i.productId === productId);
      if (item) {
        item.unitPrice = Math.max(0, unitPrice);
        item.priceEdited = true;
        // A price change replaces any manual % discount — keeping both
        // would double-dip. The trade auto % (company policy) stays.
        item.discountPercent = 0;
      }
      recalculateTotals(state);
    },

    setCartDiscount: (state, action: PayloadAction<CartDiscount | null>) => {
      state.cartDiscount = action.payload;
      recalculateTotals(state);
    },

    setCustomer: (
      state,
      action: PayloadAction<{ id: number; name: string; isTrade?: boolean } | null>
    ) => {
      if (action.payload) {
        state.customerId = action.payload.id;
        state.customerName = action.payload.name;
        state.customerIsTrade = !!action.payload.isTrade;
      } else {
        state.customerId = null;
        state.customerName = null;
        state.customerIsTrade = false;
        // Clear any previously-applied auto discount so totals snap
        // back when the cashier clears / swaps the customer.
        state.items.forEach((it) => {
          it.autoDiscountPercent = 0;
          it.autoDiscountLabel = null;
        });
        recalculateTotals(state);
      }
    },

    // Bulk-set auto discounts for the current cart from the backend
    // preview response. Items not in the map keep their existing auto.
    setTradeAutoDiscounts: (
      state,
      action: PayloadAction<
        Record<number, { percent: number; label: string | null }>
      >,
    ) => {
      const map = action.payload || {};
      state.items.forEach((it) => {
        const hit = map[it.productId];
        let pct = hit ? hit.percent : 0;
        let label = hit ? (hit.label as string | null) : null;
        // Customer-price-wins (Sally row 367): when the trade rate off
        // the fixed retail base still lands ABOVE what a walk-in would
        // pay (deep sale), charge the customer price and drop the trade
        // discount. Re-derives from the captured bases each time, so it
        // works whether the trade customer was attached before or after
        // the item was added. Skips cashier-re-priced lines.
        if (
          hit &&
          !it.priceEdited &&
          it.tradeBasePrice != null &&
          it.retailSalePrice != null
        ) {
          const tradeNet = it.tradeBasePrice * (1 - pct / 100);
          if (it.retailSalePrice < tradeNet) {
            it.unitPrice = it.retailSalePrice;
            pct = 0;
            label = null;
          } else {
            it.unitPrice = it.tradeBasePrice;
          }
        }
        it.autoDiscountPercent = pct;
        it.autoDiscountLabel = label;
      });
      recalculateTotals(state);
    },

    setNotes: (state, action: PayloadAction<string>) => {
      state.notes = action.payload;
    },

    setExchangeContext: (
      state,
      action: PayloadAction<{ orderId: number; orderNumber: string } | null>,
    ) => {
      state.exchangeFromOrderId = action.payload?.orderId ?? null;
      state.exchangeFromOrderNumber = action.payload?.orderNumber ?? null;
    },

    // Replace the whole cart with an open quote's lines — quoted prices
    // and discounts locked in exactly as negotiated. From here the sale
    // proceeds like any other (backorder / lay-by ticks, payment).
    loadQuote: (
      state,
      action: PayloadAction<{
        quoteId: number;
        quoteNumber: string;
        customer?: { id: number; name: string; isTrade?: boolean } | null;
        notes?: string;
        items: Array<{
          productId: number;
          sku: string;
          name: string;
          quantity: number;
          unitPrice: number;
          discountPercent: number;
        }>;
      }>,
    ) => {
      const p = action.payload;
      state.items = p.items.map((it) => ({
        productId: it.productId,
        sku: it.sku,
        name: it.name,
        quantity: Math.max(1, Number(it.quantity) || 1),
        unitPrice: Math.max(0, Number(it.unitPrice) || 0),
        // Quoted discount rides as the manual % — trade auto-discounts
        // are suppressed for quote carts so nothing re-applies on top.
        discountPercent: Math.max(0, Math.min(100, Number(it.discountPercent) || 0)),
        autoDiscountPercent: 0,
        autoDiscountLabel: null,
        discountAmount: 0,
        taxAmount: 0,
        rowTotal: 0,
      }));
      state.customerId = p.customer?.id ?? null;
      state.customerName = p.customer?.name ?? null;
      state.customerIsTrade = !!p.customer?.isTrade;
      state.fromQuoteId = p.quoteId;
      state.fromQuoteNumber = p.quoteNumber;
      state.exchangeFromOrderId = null;
      state.exchangeFromOrderNumber = null;
      state.cartDiscount = null;
      state.notes = p.notes || '';
      recalculateTotals(state);
    },

    clearCart: (state) => {
      state.items = [];
      state.customerId = null;
      state.customerName = null;
      state.customerIsTrade = false;
      state.exchangeFromOrderId = null;
      state.exchangeFromOrderNumber = null;
      state.fromQuoteId = null;
      state.fromQuoteNumber = null;
      state.cartDiscount = null;
      state.subtotal = 0;
      state.itemDiscounts = 0;
      state.cartDiscountAmount = 0;
      state.taxAmount = 0;
      state.grandTotal = 0;
      state.notes = '';
      state.deliveryType = 'pickup';
      state.deliveryFee = 0;
    },

    // Broadcast the delivery method + fee from PaymentModal so the cart
    // sidebar's total agrees with what the customer will actually pay.
    // Cleared on clearCart.
    setDelivery: (
      state,
      action: PayloadAction<{
        deliveryType: CartState['deliveryType'];
        deliveryFee: number;
      }>,
    ) => {
      state.deliveryType = action.payload.deliveryType;
      state.deliveryFee =
        Math.round((action.payload.deliveryFee || 0) * 100) / 100;
    },

    applyCalculatedTotals: (
      state,
      action: PayloadAction<{
        items: CartItem[];
        subtotal: number;
        itemDiscounts: number;
        cartDiscount: number;
        taxAmount: number;
        grandTotal: number;
      }>
    ) => {
      // Apply server-calculated totals
      const { items, subtotal, itemDiscounts, cartDiscount, taxAmount, grandTotal } =
        action.payload;

      state.items = items;
      state.subtotal = subtotal;
      state.itemDiscounts = itemDiscounts;
      state.cartDiscountAmount = cartDiscount;
      state.taxAmount = taxAmount;
      state.grandTotal = grandTotal;
    },
  },
});

export const {
  addItem,
  removeItem,
  updateQuantity,
  setItemDiscount,
  setItemUnitPrice,
  setCartDiscount,
  setCustomer,
  setTradeAutoDiscounts,
  setNotes,
  setExchangeContext,
  loadQuote,
  clearCart,
  setDelivery,
  applyCalculatedTotals,
} = cartSlice.actions;

export default cartSlice.reducer;
