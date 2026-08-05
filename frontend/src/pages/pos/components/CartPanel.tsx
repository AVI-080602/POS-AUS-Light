import { useState } from 'react';
import { useSelector } from 'react-redux';
import type { RootState } from '../../../store';
import {
  TrashIcon,
  MinusIcon,
  PlusIcon,
  UserIcon,
  XMarkIcon,
  TagIcon,
  ExclamationTriangleIcon,
  MagnifyingGlassIcon,
  PencilSquareIcon,
} from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';
import { CartItem, CartDiscount } from '../../../store/slices/cartSlice';
import { competitorApi, customersApi } from '../../../services/api';

interface CartPanelProps {
  items: CartItem[];
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  customerName: string | null;
  cartDiscount: CartDiscount | null;
  maxDiscountPercent: number;
  canStackDiscounts: boolean;
  stockMap?: Record<number, number>; // productId -> available stock
  // Trade auto-discount % keyed by productId — used to render the yellow
  // "Trade $X" tag next to each line's unit price.
  tradePctMap?: Record<number, number>;
  // Wholesale cost keyed by productId (manager/admin only — the backend
  // omits it from the product API for other roles, so this map is simply
  // empty for them). When a line's actual sell price falls below
  // cost * 1.30, the cart shows a "Below cost price" warning. The backend
  // hard-blocks the sale on checkout for sales_staff; managers/admins can
  // still complete it.
  costMap?: Record<number, number>;
  onRemoveItem: (productId: number) => void;
  onUpdateQuantity: (productId: number, quantity: number) => void;
  onSetItemDiscount: (productId: number, discountPercent: number) => void;
  onSetItemUnitPrice: (productId: number, unitPrice: number) => void;
  onSetCartDiscount: (discount: CartDiscount | null) => void;
  onSetCustomer: (customer: { id: number; name: string; isTrade?: boolean } | null) => void;
  onClearCart: () => void;
  onCheckout: () => void;
}

export default function CartPanel({
  items,
  subtotal,
  discount,
  tax,
  total,
  customerName,
  cartDiscount,
  maxDiscountPercent,
  canStackDiscounts,
  stockMap = {},
  tradePctMap = {},
  costMap = {},
  onRemoveItem,
  onUpdateQuantity,
  onSetItemDiscount,
  onSetItemUnitPrice,
  onSetCartDiscount,
  onSetCustomer,
  onClearCart,
  onCheckout,
}: CartPanelProps) {
  // Delivery is picked in PaymentModal but mirrored to the cart slice
  // so this sidebar can show the fee + a matching grand total.
  const deliveryFee = useSelector((s: RootState) => s.cart.deliveryFee);
  const deliveryType = useSelector((s: RootState) => s.cart.deliveryType);
  const [showDiscountModal, setShowDiscountModal] = useState(false);
  const [showCustomerModal, setShowCustomerModal] = useState(false);
  const [custResults, setCustResults] = useState<any[]>([]);
  const [custSearching, setCustSearching] = useState(false);
  const [showCreateCustomer, setShowCreateCustomer] = useState(false);
  const [newCustFirstName, setNewCustFirstName] = useState('');
  const [newCustLastName, setNewCustLastName] = useState('');
  const [newCustEmail, setNewCustEmail] = useState('');
  const [newCustPhone, setNewCustPhone] = useState('');
  const [newCustIsTrade, setNewCustIsTrade] = useState(false);
  const [createCustError, setCreateCustError] = useState('');
  const [discountType, setDiscountType] = useState<'percent' | 'fixed'>('percent');
  const [discountValue, setDiscountValue] = useState('');
  const [discountReason, setDiscountReason] = useState('');
  const [editingItemDiscount, setEditingItemDiscount] = useState<number | null>(null);
  const [itemDiscountValue, setItemDiscountValue] = useState('');
  const [editingUnitPrice, setEditingUnitPrice] = useState<number | null>(null);
  const [unitPriceInput, setUnitPriceInput] = useState('');
  const [editingQuantity, setEditingQuantity] = useState<number | null>(null);
  const [quantityInput, setQuantityInput] = useState('');
  const [competitorPrices, setCompetitorPrices] = useState<
    Record<number, { price: number | null; loading: boolean; error?: string; url?: string | null }>
  >({});

  const handleComparePrice = async (productId: number, productName: string, sku: string) => {
    // If already loaded, toggle visibility by clearing it
    if (competitorPrices[productId] && !competitorPrices[productId].loading) {
      setCompetitorPrices((prev) => {
        const next = { ...prev };
        delete next[productId];
        return next;
      });
      return;
    }

    setCompetitorPrices((prev) => ({
      ...prev,
      [productId]: { price: null, loading: true },
    }));

    try {
      const { data } = await competitorApi.getPrice(productName, sku);
      setCompetitorPrices((prev) => ({
        ...prev,
        [productId]: {
          price: data.price,
          loading: false,
          error: data.error,
          url: data.url,
        },
      }));
    } catch {
      setCompetitorPrices((prev) => ({
        ...prev,
        [productId]: { price: null, loading: false, error: 'Failed to fetch' },
      }));
    }
  };

  const handleQuantityBlur = (productId: number) => {
    setEditingQuantity(null);
    const qty = parseInt(quantityInput, 10);
    if (!isNaN(qty) && qty > 0) {
      onUpdateQuantity(productId, qty);
    } else if (qty === 0 || quantityInput === '') {
      // If 0 or empty, remove the item
      onRemoveItem(productId);
    }
  };

  const handleQuantityKeyDown = (e: React.KeyboardEvent, productId: number) => {
    if (e.key === 'Enter') {
      handleQuantityBlur(productId);
    } else if (e.key === 'Escape') {
      setEditingQuantity(null);
    }
  };

  // A discount is "one or the other": once any line carries a manual
  // item discount, the cart-level "Further Discount" is blocked, and
  // vice versa. (Trade auto-discount on autoDiscountPercent doesn't
  // count — that's company pricing, not a staff discount.)
  const hasItemDiscount = items.some((i) => (i.discountPercent || 0) > 0);

  const handleApplyCartDiscount = () => {
    const value = parseFloat(discountValue);
    if (!(value > 0)) return;
    if (hasItemDiscount) {
      toast.error(
        'A line already has an item discount. Remove it first — only one discount (item OR further) is allowed per sale.',
      );
      return;
    }
    if (discountType === 'percent' && value > maxDiscountPercent) {
      toast.error(`Maximum discount is ${maxDiscountPercent}%`);
      return;
    }
    // Cap the fixed-amount discount. It can never exceed the sale
    // subtotal (you can't discount more than the price — that's what
    // zeroed a $239 sale with a $500 discount), and for limited roles
    // it's further capped to their max-discount percentage.
    if (discountType === 'fixed') {
      const cap =
        Math.round(
          Math.min(subtotal, (maxDiscountPercent / 100) * subtotal) * 100,
        ) / 100;
      if (value > cap) {
        toast.error(
          `Maximum fixed discount is $${cap.toFixed(2)} ` +
            `(can't discount more than the $${subtotal.toFixed(2)} sale` +
            `${maxDiscountPercent < 100 ? `, limited to ${maxDiscountPercent}%` : ''}).`,
        );
        return;
      }
    }
    if (!discountReason.trim()) {
      toast.error('Please enter a reason for the discount');
      return;
    }
    onSetCartDiscount({
      type: discountType,
      value,
      reason: discountReason.trim(),
    });
    setShowDiscountModal(false);
    setDiscountValue('');
    setDiscountReason('');
  };

  const handleApplyItemDiscount = (productId: number) => {
    const value = parseFloat(itemDiscountValue);
    if (value > 0 && cartDiscount) {
      toast.error(
        'A further (cart) discount is already applied. Remove it first — only one discount type is allowed per sale.',
      );
      return;
    }
    if (value >= 0 && value <= maxDiscountPercent) {
      onSetItemDiscount(productId, value);
    } else if (value > maxDiscountPercent) {
      toast.error(`Maximum discount is ${maxDiscountPercent}%`);
      return;
    }
    setEditingItemDiscount(null);
    setItemDiscountValue('');
  };

  return (
    <div className="w-80 bg-pos-card border-l border-gray-700 flex flex-col">
      {/* Header */}
      <div className="p-4 border-b border-gray-700 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Current Sale</h2>
        {items.length > 0 && (
          <button
            className="text-red-400 hover:text-red-300 text-sm flex items-center gap-1"
            onClick={onClearCart}
          >
            <XMarkIcon className="h-4 w-4" />
            Clear
          </button>
        )}
      </div>

      {/* Customer */}
      <div className="p-4 border-b border-gray-700">
        {customerName ? (
          <div className="flex items-center justify-between bg-pos-accent rounded-lg px-3 py-2">
            <div className="flex items-center gap-2">
              <UserIcon className="h-5 w-5 text-primary-400" />
              <span className="font-medium">{customerName}</span>
            </div>
            <button
              className="text-gray-400 hover:text-red-400"
              onClick={() => onSetCustomer(null)}
              title="Remove customer"
            >
              <XMarkIcon className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <button
            className="w-full btn-secondary flex items-center justify-center gap-2"
            onClick={() => { setShowCustomerModal(true); setCustResults([]); setShowCreateCustomer(false); }}
          >
            <UserIcon className="h-5 w-5" />
            Create / Search Customer
          </button>
        )}
      </div>

      {/* Cart Items */}
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {items.length === 0 ? (
          <div className="h-full flex items-center justify-center text-gray-500">
            Cart is empty
          </div>
        ) : (
          <div className="divide-y divide-gray-700">
            {items.map((item) => (
              <div key={item.productId} className="p-4">
                <div className="flex gap-3">
                  {/* Image */}
                  <div className="w-12 h-12 bg-pos-accent rounded overflow-hidden flex-shrink-0">
                    {item.imageUrl ? (
                      <img
                        src={item.imageUrl}
                        alt={item.name}
                        className="w-full h-full object-cover"
                        loading="lazy"
                        onError={(e) => {
                          const img = e.currentTarget;
                          img.onerror = null;
                          img.style.display = 'none';
                          const parent = img.parentElement;
                          if (parent && !parent.querySelector('[data-img-fallback]')) {
                            const fb = document.createElement('div');
                            fb.dataset.imgFallback = 'true';
                            fb.className =
                              'w-full h-full flex items-center justify-center text-gray-500 text-xs';
                            fb.textContent = 'N/A';
                            parent.appendChild(fb);
                          }
                        }}
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-gray-500 text-xs">
                        N/A
                      </div>
                    )}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <h3 className="font-medium text-sm truncate">{item.name}</h3>
                    <p className="text-xs text-gray-400 font-mono">{item.sku}</p>
                    {item.isBackorder && (
                      <span
                        className="inline-block mt-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase bg-cyan-600/30 text-cyan-300"
                        title="Ordering from supplier"
                      >
                        Backorder · Ordering from supplier
                      </span>
                    )}
                    <div className="flex items-center justify-between mt-1">
                      {editingUnitPrice === item.productId ? (
                        <input
                          type="number"
                          step="0.01"
                          min={0}
                          autoFocus
                          className="input py-0.5 px-1.5 text-sm w-24"
                          value={unitPriceInput}
                          onChange={(e) => setUnitPriceInput(e.target.value)}
                          onBlur={() => {
                            const v = parseFloat(unitPriceInput);
                            if (!isNaN(v) && v >= 0) {
                              onSetItemUnitPrice(item.productId, v);
                            }
                            setEditingUnitPrice(null);
                            setUnitPriceInput('');
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              const v = parseFloat(unitPriceInput);
                              if (!isNaN(v) && v >= 0) {
                                onSetItemUnitPrice(item.productId, v);
                              }
                              setEditingUnitPrice(null);
                              setUnitPriceInput('');
                            } else if (e.key === 'Escape') {
                              setEditingUnitPrice(null);
                              setUnitPriceInput('');
                            }
                          }}
                        />
                      ) : (
                        (() => {
                          // Show the struck-through list price next to the
                          // net price whenever a discount is applied, so the
                          // cashier sees what the customer actually pays
                          // without opening the discount box.
                          const effective = Math.max(
                            item.discountPercent || 0,
                            item.autoDiscountPercent || 0,
                          );
                          const netPrice =
                            Math.round(
                              item.unitPrice * (1 - effective / 100) * 100,
                            ) / 100;
                          return (
                            <button
                              className="text-sm hover:text-primary-400 flex items-center gap-1.5"
                              title="Click to edit unit price"
                              onClick={() => {
                                setEditingUnitPrice(item.productId);
                                setUnitPriceInput(item.unitPrice.toFixed(2));
                              }}
                            >
                              {effective > 0 ? (
                                <>
                                  <span className="text-gray-500 line-through">
                                    ${item.unitPrice.toFixed(2)}
                                  </span>
                                  <span className="font-semibold text-green-400">
                                    ${netPrice.toFixed(2)}
                                  </span>
                                </>
                              ) : (
                                <span>${item.unitPrice.toFixed(2)}</span>
                              )}
                              <PencilSquareIcon className="h-3 w-3 text-gray-500" />
                            </button>
                          );
                        })()
                      )}
                      {(() => {
                        const pct = tradePctMap[item.productId] || 0;
                        if (pct <= 0) return null;
                        const tradePrice =
                          Math.round(item.unitPrice * (1 - pct / 100) * 100) /
                          100;
                        return (
                          <span
                            className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-yellow-400/20 text-yellow-300 border border-yellow-500/40"
                            title={`Trade price (${pct}% off)`}
                          >
                            Trade ${tradePrice.toFixed(2)}
                          </span>
                        );
                      })()}
                      {(() => {
                        const effective = Math.max(
                          item.discountPercent || 0,
                          item.autoDiscountPercent || 0,
                        );
                        if (effective <= 0) return null;
                        const isAuto =
                          (item.autoDiscountPercent || 0) >=
                          (item.discountPercent || 0);
                        return (
                          <span
                            className={`text-xs ${
                              isAuto ? 'text-orange-400' : 'text-green-400'
                            }`}
                            title={
                              isAuto
                                ? item.autoDiscountLabel || 'Trade auto'
                                : ''
                            }
                          >
                            -{effective}%{isAuto ? ' trade' : ''}
                          </span>
                        );
                      })()}
                    </div>
                  </div>

                  {/* Remove button */}
                  <button
                    className="text-gray-400 hover:text-red-400"
                    onClick={() => onRemoveItem(item.productId)}
                  >
                    <TrashIcon className="h-5 w-5" />
                  </button>
                </div>

                {/* Quantity controls and item discount */}
                {(() => {
                  const stock = stockMap[item.productId];
                  const exceedsStock = stock !== undefined && item.quantity > stock;
                  return (
                    <>
                      <div className="flex items-center justify-between mt-3">
                        <div className="flex items-center gap-2">
                          <button
                            className="w-8 h-8 bg-pos-accent rounded flex items-center justify-center hover:bg-pos-bg"
                            onClick={() =>
                              onUpdateQuantity(item.productId, item.quantity - 1)
                            }
                          >
                            <MinusIcon className="h-4 w-4" />
                          </button>
                          {editingQuantity === item.productId ? (
                            <input
                              type="number"
                              className={`w-14 h-8 text-center font-mono bg-pos-bg border rounded text-sm ${
                                exceedsStock ? 'border-yellow-500' : 'border-gray-600'
                              }`}
                              value={quantityInput}
                              onChange={(e) => setQuantityInput(e.target.value)}
                              onBlur={() => handleQuantityBlur(item.productId)}
                              onKeyDown={(e) => handleQuantityKeyDown(e, item.productId)}
                              min={0}
                              autoFocus
                            />
                          ) : (
                            <button
                              className={`w-14 h-8 text-center font-mono bg-pos-bg border rounded hover:border-primary-500 ${
                                exceedsStock ? 'border-yellow-500 text-yellow-400' : 'border-gray-600'
                              }`}
                              onClick={() => {
                                setEditingQuantity(item.productId);
                                setQuantityInput(item.quantity.toString());
                              }}
                            >
                              {item.quantity}
                            </button>
                          )}
                          <button
                            className="w-8 h-8 bg-pos-accent rounded flex items-center justify-center hover:bg-pos-bg"
                            onClick={() =>
                              onUpdateQuantity(item.productId, item.quantity + 1)
                            }
                          >
                            <PlusIcon className="h-4 w-4" />
                          </button>
                          {/* Item discount button. SALE/clearance items
                              CAN be discounted — the cashier just gets a
                              heads-up that the item is already marked
                              down (was a hard block before). Still
                              mutually exclusive with a cart-level
                              discount (one-or-the-other rule), and the
                              below-cost warning / cost+30% floor still
                              apply to the discounted price. */}
                          <button
                            className={`w-8 h-8 rounded flex items-center justify-center ${
                              cartDiscount
                                ? 'bg-red-900/50 text-red-400 cursor-not-allowed'
                                : item.discountPercent > 0
                                ? 'bg-green-600 text-white'
                                : 'bg-pos-accent hover:bg-pos-bg text-gray-400'
                            }`}
                            onClick={() => {
                              if (cartDiscount) {
                                toast.error('A further (cart) discount is already applied. Remove it first — only one discount type per sale.');
                                return;
                              }
                              if (item.isSaleItem) {
                                toast('Clearance / sale item — already marked down. Discount applies on top of the sale price.', {
                                  icon: '⚠️',
                                  duration: 4000,
                                });
                              }
                              setEditingItemDiscount(item.productId);
                              setItemDiscountValue(item.discountPercent.toString());
                            }}
                            title="Apply item discount"
                          >
                            <TagIcon className="h-4 w-4" />
                          </button>
                          {/* Compare competitor price button */}
                          <button
                            className={`w-8 h-8 rounded flex items-center justify-center ${
                              competitorPrices[item.productId]?.price
                                ? 'bg-blue-600 text-white'
                                : 'bg-pos-accent hover:bg-pos-bg text-gray-400 hover:text-primary-400'
                            }`}
                            onClick={() => handleComparePrice(item.productId, item.name, item.sku)}
                            title="Check competitor price"
                          >
                            {competitorPrices[item.productId]?.loading ? (
                              <div className="h-4 w-4 border-2 border-gray-400 border-t-white rounded-full animate-spin" />
                            ) : (
                              <MagnifyingGlassIcon className="h-4 w-4" />
                            )}
                          </button>
                        </div>
                        <span className="font-bold">
                          ${item.rowTotal.toFixed(2)}
                        </span>
                      </div>
                      {/* Stock warning */}
                      {exceedsStock && (
                        <div className="mt-2 flex items-center gap-1 text-yellow-400 text-xs">
                          <ExclamationTriangleIcon className="h-4 w-4" />
                          <span>Only {stock} in stock</span>
                        </div>
                      )}
                      {/* Below-cost warning — applies to every customer.
                          The minimum margin is cost + 30%; the backend
                          hard-blocks checkout at this threshold for
                          sales_staff (managers/admins can override). Uses
                          the actual per-unit sell price (rowTotal / qty),
                          not the pre-discount unitPrice. */}
                      {(() => {
                        const cost = costMap[item.productId];
                        if (!cost || cost <= 0) return null;
                        const floor = cost * 1.3;
                        const sellPrice = item.rowTotal / item.quantity;
                        if (sellPrice >= floor) return null;
                        return (
                          <div className="mt-2 flex items-center gap-1 text-red-400 text-xs">
                            <ExclamationTriangleIcon className="h-4 w-4" />
                            <span>
                              Below cost price (min ${floor.toFixed(2)} = cost ${cost.toFixed(2)} + 30%)
                            </span>
                          </div>
                        );
                      })()}
                      {/* Competitor price */}
                      {competitorPrices[item.productId] && !competitorPrices[item.productId].loading && (
                        <div className="mt-2 flex items-center gap-2 text-xs">
                          {competitorPrices[item.productId].price !== null ? (
                            <>
                              <span className="text-gray-400">Competitor:</span>
                              <span className={`font-bold ${
                                competitorPrices[item.productId].price! < item.unitPrice
                                  ? 'text-red-400'
                                  : competitorPrices[item.productId].price! > item.unitPrice
                                  ? 'text-green-400'
                                  : 'text-yellow-400'
                              }`}>
                                ${competitorPrices[item.productId].price!.toFixed(2)}
                              </span>
                              {competitorPrices[item.productId].price! < item.unitPrice && (
                                <span className="text-red-400">
                                  (${(item.unitPrice - competitorPrices[item.productId].price!).toFixed(2)} more)
                                </span>
                              )}
                              {competitorPrices[item.productId].price! > item.unitPrice && (
                                <span className="text-green-400">
                                  (${(competitorPrices[item.productId].price! - item.unitPrice).toFixed(2)} cheaper)
                                </span>
                              )}
                              {competitorPrices[item.productId].url && (
                                <a
                                  href={competitorPrices[item.productId].url!}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-blue-400 hover:text-blue-300 underline ml-auto"
                                >
                                  View
                                </a>
                              )}
                            </>
                          ) : (
                            <span className="text-gray-500">
                              {competitorPrices[item.productId].error || 'Not found on competitor site'}
                            </span>
                          )}
                        </div>
                      )}
                      {/* Item discount input — laid out compactly so it
                          fits inside the cart panel without overflowing
                          to the right. The % suffix sits inside the
                          input so the cashier can see the unit. */}
                      {editingItemDiscount === item.productId && (
                        <div className="mt-2 flex items-center gap-1">
                          <div className="relative flex-1 min-w-0">
                            <input
                              type="number"
                              className="input w-full text-sm py-1 pr-6"
                              placeholder={maxDiscountPercent >= 100 ? 'No limit' : `Max ${maxDiscountPercent}`}
                              value={itemDiscountValue}
                              onChange={(e) => setItemDiscountValue(e.target.value)}
                              max={maxDiscountPercent}
                              min={0}
                              autoFocus
                            />
                            <span className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 text-xs font-semibold pointer-events-none">
                              %
                            </span>
                          </div>
                          <button
                            className="btn-sm bg-green-600 text-white px-2 py-1 text-xs whitespace-nowrap"
                            onClick={() => handleApplyItemDiscount(item.productId)}
                          >
                            Apply
                          </button>
                          <button
                            className="btn-sm bg-gray-600 text-white px-1.5 py-1"
                            onClick={() => {
                              setEditingItemDiscount(null);
                              setItemDiscountValue('');
                            }}
                          >
                            <XMarkIcon className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Totals */}
      <div className="border-t border-gray-700 p-4 space-y-2">
        <div className="flex justify-between text-sm">
          <span className="text-gray-400">Subtotal</span>
          <span>${subtotal.toFixed(2)}</span>
        </div>
        {discount > 0 && (
          <div className="flex justify-between text-sm text-green-400">
            <span className="flex items-center gap-1">
              Discount
              {cartDiscount && (
                <button
                  className="text-red-400 hover:text-red-300"
                  onClick={() => onSetCartDiscount(null)}
                  title="Remove cart discount"
                >
                  <XMarkIcon className="h-3 w-3" />
                </button>
              )}
            </span>
            <span>-${discount.toFixed(2)}</span>
          </div>
        )}
        <div className="flex justify-between text-sm">
          <span className="text-gray-400">GST included</span>
          <span>${tax.toFixed(2)}</span>
        </div>
        {/* Delivery fee — populated by PaymentModal when the cashier
            picks a fulfilment method. Keeps the sidebar total in
            sync with the Payment screen so both agree on what the
            customer will pay. */}
        {deliveryFee > 0 && (
          <div className="flex justify-between text-sm text-cyan-300">
            <span>Delivery ({deliveryType.replace(/_/g, ' ')})</span>
            <span>+${deliveryFee.toFixed(2)}</span>
          </div>
        )}
        <div className="flex justify-between text-xl font-bold pt-2 border-t border-gray-600">
          <span>Total (incl. GST)</span>
          <span className="text-primary-400">
            ${(total + deliveryFee).toFixed(2)}
          </span>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="p-4 pt-0 space-y-2">
        {/* Cart Discount Button — disabled when a line already has an
            item discount (one-or-the-other rule). */}
        {items.length > 0 && (
          <button
            className={`w-full btn flex items-center justify-center gap-2 ${
              cartDiscount
                ? 'bg-green-600 text-white'
                : hasItemDiscount
                  ? 'bg-pos-accent/50 text-gray-500 cursor-not-allowed'
                  : 'bg-pos-accent text-gray-300 hover:bg-pos-bg'
            }`}
            disabled={!cartDiscount && hasItemDiscount}
            title={
              !cartDiscount && hasItemDiscount
                ? 'Remove the item discount first — only one discount per sale'
                : undefined
            }
            onClick={() => setShowDiscountModal(true)}
          >
            <TagIcon className="h-5 w-5" />
            {cartDiscount
              ? `Further Discount: ${cartDiscount.type === 'percent' ? `${cartDiscount.value}%` : `$${cartDiscount.value}`}`
              : hasItemDiscount
                ? 'Further Discount (item discount applied)'
                : 'Add Further Discount'}
          </button>
        )}

        {/* Checkout Button */}
        <button
          className="btn-success w-full btn-lg text-lg"
          onClick={onCheckout}
          disabled={items.length === 0}
        >
          Pay ${total.toFixed(2)}
        </button>
      </div>

      {/* Cart Discount Modal — compact popup so it doesn't take over the
          screen for what is essentially a single-field input. */}
      {showDiscountModal && (
        <div className="modal-backdrop-small" onClick={() => setShowDiscountModal(false)}>
          <div className="modal-content-small max-w-sm" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold">Apply Further Discount</h3>
              <button
                className="text-gray-400 hover:text-white"
                onClick={() => setShowDiscountModal(false)}
              >
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>

            <p className="text-sm text-gray-400 mb-4">
              Max discount: {maxDiscountPercent >= 100 ? 'No Limit (Admin)' : `${maxDiscountPercent}%`} | Stacking: {canStackDiscounts ? 'Allowed' : 'Not allowed'}
            </p>

            {/* Discount Type */}
            <div className="flex gap-2 mb-4">
              <button
                className={`flex-1 py-2 rounded-lg border-2 transition-colors ${
                  discountType === 'percent'
                    ? 'border-primary-500 bg-primary-500/20'
                    : 'border-gray-600'
                }`}
                onClick={() => setDiscountType('percent')}
              >
                Percentage (%)
              </button>
              <button
                className={`flex-1 py-2 rounded-lg border-2 transition-colors ${
                  discountType === 'fixed'
                    ? 'border-primary-500 bg-primary-500/20'
                    : 'border-gray-600'
                }`}
                onClick={() => setDiscountType('fixed')}
              >
                Fixed ($)
              </button>
            </div>

            {/* Discount Value — show a % or $ suffix glued to the input
                so the cashier can see at a glance which mode they're in. */}
            <div className="mb-4">
              <label className="block text-sm text-gray-400 mb-1">
                {discountType === 'percent' ? (maxDiscountPercent >= 100 ? 'Discount % (No Limit)' : `Discount % (max ${maxDiscountPercent}%)`) : 'Discount Amount ($)'}
              </label>
              <div className="relative">
                {discountType === 'fixed' && (
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none">
                    $
                  </span>
                )}
                <input
                  type="number"
                  className={`input ${discountType === 'percent' ? 'pr-10' : 'pl-7'}`}
                  placeholder={discountType === 'percent' ? '10' : '50.00'}
                  value={discountValue}
                  onChange={(e) => setDiscountValue(e.target.value)}
                  max={discountType === 'percent' ? maxDiscountPercent : undefined}
                  min={0}
                  autoFocus
                />
                {discountType === 'percent' && (
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 font-semibold pointer-events-none">
                    %
                  </span>
                )}
              </div>
            </div>

            {/* Reason — required so the audit log shows why the
                discount was given. */}
            <div className="mb-4">
              <label className="block text-sm text-gray-400 mb-1">Reason *</label>
              <input
                type="text"
                className="input"
                placeholder="e.g., Loyal customer, Price match"
                value={discountReason}
                onChange={(e) => setDiscountReason(e.target.value)}
              />
            </div>

            {/* Apply Button */}
            <button
              className="btn-primary w-full"
              onClick={handleApplyCartDiscount}
              disabled={
                !discountValue ||
                parseFloat(discountValue) <= 0 ||
                !discountReason.trim()
              }
            >
              Apply Discount
            </button>
          </div>
        </div>
      )}

      {/* Customer Search / Create Modal */}
      {showCustomerModal && (
        <div className="modal-backdrop" onClick={() => setShowCustomerModal(false)}>
          <div className="modal-content max-w-md" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold">
                {showCreateCustomer ? 'Create New Customer' : 'Create / Search Customer'}
              </h3>
              <button
                className="text-gray-400 hover:text-white"
                onClick={() => setShowCustomerModal(false)}
              >
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>

            {!showCreateCustomer ? (
              <>
                {/* Separate search fields */}
                <div className="space-y-3 mb-4">
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Customer ID</label>
                    <input
                      type="number"
                      placeholder="Enter customer ID"
                      className="input"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          const val = (e.target as HTMLInputElement).value.trim();
                          if (val) {
                            setCustSearching(true);
                            customersApi
                              .getCustomers({ search: val, limit: 10 })
                              .then((res) => {
                                const all = res.data.data?.customers || [];
                                setCustResults(all.filter((c: any) => c.id === parseInt(val)));
                              })
                              .catch(() => setCustResults([]))
                              .finally(() => setCustSearching(false));
                          }
                        }
                      }}
                      autoFocus
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Customer Name</label>
                    <input
                      type="text"
                      placeholder="Search by name"
                      className="input"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          const val = (e.target as HTMLInputElement).value.trim();
                          if (val.length >= 2) {
                            setCustSearching(true);
                            customersApi
                              .getCustomers({ search: val, limit: 10 })
                              .then((res) => setCustResults(res.data.data?.customers || []))
                              .catch(() => setCustResults([]))
                              .finally(() => setCustSearching(false));
                          }
                        }
                      }}
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Phone Number</label>
                    <input
                      type="tel"
                      placeholder="Search by phone"
                      className="input"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          const val = (e.target as HTMLInputElement).value.trim();
                          if (val.length >= 3) {
                            setCustSearching(true);
                            customersApi
                              .getCustomers({ search: val, limit: 10 })
                              .then((res) => setCustResults(res.data.data?.customers || []))
                              .catch(() => setCustResults([]))
                              .finally(() => setCustSearching(false));
                          }
                        }
                      }}
                    />
                  </div>
                </div>

                <p className="text-xs text-gray-500 mb-3">Type in any field and press Enter to search</p>

                {/* Results */}
                <div className="space-y-1 mb-4 max-h-48 overflow-auto">
                  {custSearching && (
                    <p className="text-sm text-gray-400 text-center py-2">Searching...</p>
                  )}
                  {!custSearching && custResults.length > 0 && (
                    <>
                      <p className="text-xs text-gray-400 mb-1">{custResults.length} result(s)</p>
                      {custResults.map((c: any) => (
                        <button
                          key={c.id}
                          className="w-full text-left px-4 py-3 rounded-lg hover:bg-pos-accent border border-gray-700"
                          onClick={() => {
                            onSetCustomer({
                              id: c.id,
                              name: `${c.firstName} ${c.lastName}`,
                              isTrade: !!c.isTrade,
                            });
                            setShowCustomerModal(false);
                          }}
                        >
                          <p className="font-medium">{c.firstName} {c.lastName}</p>
                          <p className="text-xs text-gray-400">
                            ID: {c.id} {c.email ? `| ${c.email}` : ''} {c.phone ? `| ${c.phone}` : ''}
                          </p>
                        </button>
                      ))}
                    </>
                  )}
                </div>

                {/* Create New button */}
                <button
                  className="btn-primary w-full"
                  onClick={() => {
                    setShowCreateCustomer(true);
                    setNewCustFirstName('');
                    setNewCustLastName('');
                    setNewCustEmail('');
                    setNewCustPhone('');
                    setNewCustIsTrade(false);
                    setCreateCustError('');
                  }}
                >
                  <PlusIcon className="h-5 w-5 mr-2 inline" />
                  Create New Customer
                </button>
              </>
            ) : (
              <>
                {/* Create Customer Form */}
                <div className="space-y-3 mb-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">First Name *</label>
                      <input
                        type="text"
                        className="input"
                        placeholder="First name"
                        value={newCustFirstName}
                        onChange={(e) => setNewCustFirstName(e.target.value)}
                        autoFocus
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">Last Name</label>
                      <input
                        type="text"
                        className="input"
                        placeholder="Last name (optional)"
                        value={newCustLastName}
                        onChange={(e) => setNewCustLastName(e.target.value)}
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Email</label>
                    <input
                      type="email"
                      className="input"
                      placeholder="email@example.com"
                      value={newCustEmail}
                      onChange={(e) => setNewCustEmail(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">
                      Phone Number * <span className="text-gray-500">(10 digits)</span>
                    </label>
                    <input
                      type="tel"
                      className="input"
                      inputMode="numeric"
                      placeholder="0434310130"
                      value={newCustPhone}
                      onChange={(e) => setNewCustPhone(e.target.value)}
                    />
                  </div>
                  {/* Buyer type — trade customers get the trade-discount
                      paths, retail customers don't. Defaults to Retail. */}
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">
                      Customer Type
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setNewCustIsTrade(false)}
                        className={`px-3 py-2 rounded border text-sm font-semibold transition-colors ${
                          !newCustIsTrade
                            ? 'bg-primary-600 border-primary-500 text-white'
                            : 'bg-pos-card border-gray-700 text-gray-400 hover:text-white'
                        }`}
                      >
                        Retail
                      </button>
                      <button
                        type="button"
                        onClick={() => setNewCustIsTrade(true)}
                        className={`px-3 py-2 rounded border text-sm font-semibold transition-colors ${
                          newCustIsTrade
                            ? 'bg-amber-600 border-amber-500 text-white'
                            : 'bg-pos-card border-gray-700 text-gray-400 hover:text-white'
                        }`}
                      >
                        Trade
                      </button>
                    </div>
                  </div>
                </div>

                {createCustError && (
                  <div className="bg-red-500/20 text-red-400 p-2 rounded text-sm mb-3">
                    {createCustError}
                  </div>
                )}

                <div className="flex gap-3">
                  <button
                    className="btn-secondary flex-1"
                    onClick={() => setShowCreateCustomer(false)}
                  >
                    Back
                  </button>
                  <button
                    className="btn-primary flex-1"
                    onClick={async () => {
                      if (!newCustFirstName.trim()) {
                        setCreateCustError('First name is required');
                        return;
                      }
                      const phoneDigits = newCustPhone.replace(/\D+/g, '');
                      if (!phoneDigits) {
                        setCreateCustError('Phone number is required');
                        return;
                      }
                      if (phoneDigits.length !== 10) {
                        setCreateCustError('Phone must be exactly 10 digits');
                        return;
                      }
                      try {
                        const res = await customersApi.createCustomer({
                          firstName: newCustFirstName.trim(),
                          lastName: newCustLastName.trim() || null,
                          email: newCustEmail.trim() || null,
                          phone: phoneDigits,
                          isTrade: newCustIsTrade,
                        });
                        const created = res.data.data?.customer || res.data.data;
                        onSetCustomer({
                          id: created.id,
                          name: [created.firstName, created.lastName].filter(Boolean).join(' '),
                          isTrade: !!created.isTrade,
                        });
                        setShowCustomerModal(false);
                      } catch (err: any) {
                        setCreateCustError(
                          err.response?.data?.message ||
                            err.response?.data?.error?.message ||
                            'Failed to create customer'
                        );
                      }
                    }}
                  >
                    Create & Add
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
