import { useState } from 'react';
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline';
import { CartItem } from '../../../store/slices/cartSlice';

export interface OrderReviewSelections {
  backorderByProductId: Record<number, boolean>;
  backorderQtyByProductId: Record<number, number>;
  laybyHeldByProductId: Record<number, boolean>;
  laybyHeldQtyByProductId: Record<number, number>;
}

interface Props {
  items: CartItem[];
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  // Prior selections when re-opening the modal (e.g. cashier hit Back
  // from Payment, made a change, and came back). Overrides the
  // isBackorder-based default seed when present.
  initialSelections?: OrderReviewSelections;
  onBack: () => void;
  onContinue: (selections: OrderReviewSelections) => void;
}

export default function OrderReviewModal({
  items,
  subtotal,
  discount,
  tax,
  total,
  initialSelections,
  onBack,
  onContinue,
}: Props) {
  // Seed from prior selections if we have them (round-trip from
  // Payment → Back). Otherwise default backorder to cart's
  // pre-marked out-of-stock items; lay-by held starts off.
  const [backorder, setBackorder] = useState<Record<number, boolean>>(() =>
    initialSelections?.backorderByProductId
      ? { ...initialSelections.backorderByProductId }
      : Object.fromEntries(
          items.filter((i) => i.isBackorder).map((i) => [i.productId, true]),
        ),
  );
  const [backorderQty, setBackorderQty] = useState<Record<number, number>>(
    () => ({ ...(initialSelections?.backorderQtyByProductId || {}) }),
  );
  const [layby, setLayby] = useState<Record<number, boolean>>(() => ({
    ...(initialSelections?.laybyHeldByProductId || {}),
  }));
  const [laybyQty, setLaybyQty] = useState<Record<number, number>>(() => ({
    ...(initialSelections?.laybyHeldQtyByProductId || {}),
  }));

  const toggleBackorder = (id: number, qty: number, checked: boolean) => {
    setBackorder((prev) => ({ ...prev, [id]: checked }));
    setBackorderQty((prev) => {
      const next = { ...prev };
      if (checked) next[id] = qty;
      else delete next[id];
      return next;
    });
    // Mutually exclusive with held — clear held if backorder turned on.
    if (checked) {
      setLayby((prev) => ({ ...prev, [id]: false }));
      setLaybyQty((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    }
  };

  const toggleLayby = (id: number, qty: number, checked: boolean) => {
    setLayby((prev) => ({ ...prev, [id]: checked }));
    setLaybyQty((prev) => {
      const next = { ...prev };
      if (checked) next[id] = qty;
      else delete next[id];
      return next;
    });
    if (checked) {
      setBackorder((prev) => ({ ...prev, [id]: false }));
      setBackorderQty((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    }
  };

  const hasBackorder = Object.values(backorder).some(Boolean);
  const hasLayby = Object.values(layby).some(Boolean);

  return (
    <div className="modal-backdrop">
      <div className="bg-pos-card w-full h-full flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex justify-between items-center p-6 pb-4 border-b border-gray-700">
          <button onClick={onBack} className="modal-back-btn">
            <ArrowLeftIcon className="h-5 w-5" /> Back to Cart
          </button>
          <div className="text-right">
            <h2 className="text-xl font-bold">Review Order</h2>
            <p className="text-sm text-gray-400">
              {items.length} item{items.length === 1 ? '' : 's'} · confirm the lines, mark any Backorder / Lay By, then continue to payment
            </p>
          </div>
        </div>

        {/* Items table */}
        <div className="flex-1 overflow-y-auto p-6">
          <table className="w-full text-sm">
            <thead className="bg-pos-accent sticky top-0">
              <tr>
                <th className="px-3 py-2 text-left text-gray-300 w-12">#</th>
                <th className="px-3 py-2 text-left text-gray-300">Product</th>
                <th className="px-3 py-2 text-center text-gray-300 w-16">Qty</th>
                <th className="px-3 py-2 text-right text-gray-300 w-24">Unit</th>
                <th className="px-3 py-2 text-right text-gray-300 w-24">Line Total</th>
                {/* Column headers double as select-all toggles. Mutually
                    exclusive: ticking Backorder-all clears Lay By on
                    every line and vice-versa (mirrors per-row rule). */}
                <th className="px-3 py-2 text-center text-gray-300 w-44">
                  <div className="flex items-center justify-center gap-1.5">
                    {(() => {
                      const selected = items.filter(
                        (i) => backorder[i.productId],
                      ).length;
                      const all = selected === items.length && items.length > 0;
                      const some = selected > 0 && !all;
                      return (
                        <input
                          type="checkbox"
                          className="w-4 h-4"
                          title="Mark every line as Backorder"
                          checked={all}
                          ref={(el) => {
                            if (el) el.indeterminate = some;
                          }}
                          onChange={(e) => {
                            const on = e.target.checked;
                            items.forEach((it) =>
                              toggleBackorder(it.productId, it.quantity, on),
                            );
                          }}
                        />
                      );
                    })()}
                    <span>Backorder</span>
                  </div>
                </th>
                <th className="px-3 py-2 text-center text-gray-300 w-44">
                  <div className="flex items-center justify-center gap-1.5">
                    {(() => {
                      const selected = items.filter(
                        (i) => layby[i.productId],
                      ).length;
                      const all = selected === items.length && items.length > 0;
                      const some = selected > 0 && !all;
                      return (
                        <input
                          type="checkbox"
                          className="w-4 h-4"
                          title="Mark every line as Lay By Held"
                          checked={all}
                          ref={(el) => {
                            if (el) el.indeterminate = some;
                          }}
                          onChange={(e) => {
                            const on = e.target.checked;
                            items.forEach((it) =>
                              toggleLayby(it.productId, it.quantity, on),
                            );
                          }}
                        />
                      );
                    })()}
                    <span>Lay By Held</span>
                  </div>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700">
              {items.map((item, idx) => {
                const isBack = !!backorder[item.productId];
                const isHeld = !!layby[item.productId];
                return (
                  <tr key={item.productId} className="hover:bg-pos-accent/30">
                    <td className="px-3 py-2 text-gray-400">{idx + 1}</td>
                    <td className="px-3 py-2">
                      <p className="font-medium">{item.name}</p>
                      <p className="text-xs text-gray-400 font-mono">{item.sku}</p>
                    </td>
                    <td className="px-3 py-2 text-center">{item.quantity}</td>
                    {/* Discounted lines show the list price struck through
                        with the net unit price beside it — same treatment
                        as the cart sidebar (Sally: "$7.95 has a
                        strike-through and displays the discount price"). */}
                    <td className="px-3 py-2 text-right">
                      {(() => {
                        const pct = Math.max(
                          item.discountPercent || 0,
                          item.autoDiscountPercent || 0,
                        );
                        if (pct <= 0) {
                          return <>${item.unitPrice.toFixed(2)}</>;
                        }
                        const net =
                          Math.round(item.unitPrice * (1 - pct / 100) * 100) /
                          100;
                        return (
                          <span className="inline-flex items-center gap-1.5 justify-end">
                            <span className="text-gray-500 line-through">
                              ${item.unitPrice.toFixed(2)}
                            </span>
                            <span className="font-semibold text-green-400">
                              ${net.toFixed(2)}
                            </span>
                          </span>
                        );
                      })()}
                    </td>
                    <td className="px-3 py-2 text-right font-medium">
                      ${item.rowTotal.toFixed(2)}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <label className="inline-flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={isBack}
                          onChange={(e) =>
                            toggleBackorder(item.productId, item.quantity, e.target.checked)
                          }
                          className="w-4 h-4"
                        />
                        <span className="text-xs text-gray-400">
                          {isBack ? 'ordering' : ''}
                        </span>
                      </label>
                      {isBack && item.quantity > 1 && (
                        <div className="flex items-center justify-center gap-1 mt-1 text-xs">
                          <input
                            type="number"
                            min={1}
                            max={item.quantity}
                            value={backorderQty[item.productId] ?? item.quantity}
                            onChange={(e) =>
                              setBackorderQty((prev) => ({
                                ...prev,
                                [item.productId]: Math.max(
                                  1,
                                  Math.min(item.quantity, parseInt(e.target.value) || 1),
                                ),
                              }))
                            }
                            className="input w-14 text-center py-0.5 px-1 text-xs"
                          />
                          <span className="text-gray-500">of {item.quantity}</span>
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <label className="inline-flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={isHeld}
                          onChange={(e) =>
                            toggleLayby(item.productId, item.quantity, e.target.checked)
                          }
                          className="w-4 h-4"
                        />
                        <span className="text-xs text-gray-400">
                          {isHeld ? 'held' : ''}
                        </span>
                      </label>
                      {isHeld && item.quantity > 1 && (
                        <div className="flex items-center justify-center gap-1 mt-1 text-xs">
                          <input
                            type="number"
                            min={1}
                            max={item.quantity}
                            value={laybyQty[item.productId] ?? item.quantity}
                            onChange={(e) =>
                              setLaybyQty((prev) => ({
                                ...prev,
                                [item.productId]: Math.max(
                                  1,
                                  Math.min(item.quantity, parseInt(e.target.value) || 1),
                                ),
                              }))
                            }
                            className="input w-14 text-center py-0.5 px-1 text-xs"
                          />
                          <span className="text-gray-500">of {item.quantity}</span>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Footer: totals + actions */}
        <div className="border-t border-gray-700 p-6 flex items-center justify-between gap-6">
          <div className="text-sm text-gray-300 grid grid-cols-2 gap-x-6 gap-y-1">
            <span className="text-gray-400">Subtotal</span>
            <span className="text-right">${subtotal.toFixed(2)}</span>
            {discount > 0 && (
              <>
                <span className="text-green-400">Discount</span>
                <span className="text-right text-green-400">-${discount.toFixed(2)}</span>
              </>
            )}
            <span className="text-gray-400">GST included</span>
            <span className="text-right">${tax.toFixed(2)}</span>
            <span className="font-bold text-base">Total (incl. GST)</span>
            <span className="text-right font-bold text-base text-primary-400">
              ${total.toFixed(2)}
            </span>
          </div>

          <div className="flex items-center gap-3">
            {(hasBackorder || hasLayby) && (
              <div className="flex items-center gap-1 text-xs text-amber-300">
                <ExclamationTriangleIcon className="h-4 w-4" />
                Deposit order — full breakdown shown on the payment screen
              </div>
            )}
            <button className="btn-secondary" onClick={onBack}>
              Back
            </button>
            <button
              className="btn-success flex items-center gap-2"
              onClick={() =>
                onContinue({
                  backorderByProductId: backorder,
                  backorderQtyByProductId: backorderQty,
                  laybyHeldByProductId: layby,
                  laybyHeldQtyByProductId: laybyQty,
                })
              }
            >
              Continue to Payment <ArrowRightIcon className="h-5 w-5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
