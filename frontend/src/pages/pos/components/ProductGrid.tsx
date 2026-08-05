import { InformationCircleIcon } from '@heroicons/react/24/outline';
import {
  isProductOnSale,
  effectiveProductPrice,
} from '../../../store/slices/productsSlice';

interface Product {
  id: number;
  sku: string;
  name: string;
  price: number;
  specialPrice: number | null;
  specialPriceFrom?: string | null;
  specialPriceTo?: string | null;
  stockQty: number;
  isInStock: boolean;
  thumbnailUrl: string | null;
  productType?: string;
}

interface ProductGridProps {
  products: Product[];
  isLoading: boolean;
  onSelect: (product: Product) => void;
  // productId -> trade auto-discount percent (for the yellow trade tag)
  tradePctMap?: Record<number, number>;
  // Override the red "SALE" badge text — e.g. "CLEARANCE" when viewing
  // the Warehouse Clearance category. Defaults to "SALE".
  saleBadgeLabel?: string;
}

export default function ProductGrid({
  products,
  isLoading,
  onSelect,
  tradePctMap = {},
  saleBadgeLabel = 'SALE',
}: ProductGridProps) {
  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-gray-400">Loading products...</div>
      </div>
    );
  }

  if (products.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-gray-400">No products found</div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto scrollbar-thin">
      <div className="grid grid-cols-5 gap-2 auto-rows-max">
        {products.map((product) => {
          const onSale = isProductOnSale(product);
          // Trade price is always computed off the fixed retail
          // (product.price), even when the item is on SALE — the trade
          // discount does not stack on top of the sale discount.
          // Customer-price-wins: when a deep sale undercuts the trade
          // rate, trade pays the sale price — hide the (dearer) trade
          // badge so it can't mislead the cashier.
          const tradePct = tradePctMap[product.id] || 0;
          let tradePrice =
            tradePct > 0
              ? Math.round(Number(product.price) * (1 - tradePct / 100) * 100) / 100
              : null;
          if (tradePrice != null && effectiveProductPrice(product) <= tradePrice) {
            tradePrice = null;
          }
          return (
          <button
            key={product.id}
            className="product-card text-left group h-fit"
            onClick={() => onSelect(product)}
          >
            {/* Product Image */}
            <div className="h-28 bg-pos-accent rounded-lg mb-2 overflow-hidden relative">
              {product.thumbnailUrl ? (
                <img
                  src={product.thumbnailUrl}
                  alt={product.name}
                  className="w-full h-full object-contain p-1"
                  loading="lazy"
                  onError={(e) => {
                    // Magento occasionally returns a stale or unreachable
                    // image URL; swap to a neutral placeholder so the
                    // tile still looks intentional.
                    const img = e.currentTarget;
                    img.onerror = null;
                    img.style.display = 'none';
                    const parent = img.parentElement;
                    if (parent && !parent.querySelector('[data-img-fallback]')) {
                      const fb = document.createElement('div');
                      fb.dataset.imgFallback = 'true';
                      fb.className =
                        'w-full h-full flex items-center justify-center text-xs text-gray-500 text-center px-2';
                      fb.textContent = 'Image unavailable';
                      parent.appendChild(fb);
                    }
                  }}
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-gray-500">
                  No Image
                </div>
              )}

              {/* View details overlay on hover */}
              <div className="absolute inset-0 bg-primary-600/80 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                <div className="flex flex-col items-center gap-1 text-white">
                  <InformationCircleIcon className="h-8 w-8" />
                  <span className="text-xs font-semibold">View Details</span>
                </div>
              </div>

              {/* Out of stock overlay */}
              {!product.isInStock && (
                <div className="absolute inset-0 bg-black/70 flex items-center justify-center">
                  <span className="text-red-400 font-medium">Out of Stock</span>
                </div>
              )}

              {/* Special price badge */}
              {onSale && (
                <div className="absolute top-2 right-2 bg-red-500 text-white text-[10px] font-bold px-2 py-1 rounded whitespace-nowrap">
                  {saleBadgeLabel}
                </div>
              )}

              {/* Configurable product badge */}
              {product.productType === 'configurable' && (
                <div className="absolute top-2 left-2 bg-purple-600 text-white text-xs font-bold px-2 py-1 rounded">
                  OPTIONS
                </div>
              )}
            </div>

            {/* Product Info */}
            <div className="space-y-1">
              <p className="text-xs text-gray-400 font-mono">{product.sku}</p>
              <h3 className="font-medium text-sm line-clamp-2">{product.name}</h3>
              <div className="flex items-center gap-2 flex-wrap">
                {onSale ? (
                  <>
                    <span className="text-primary-400 font-bold">
                      ${Number(product.specialPrice).toFixed(2)}
                    </span>
                    <span className="text-gray-500 text-sm line-through">
                      ${product.price.toFixed(2)}
                    </span>
                  </>
                ) : (
                  <span className="text-primary-400 font-bold">
                    ${product.price.toFixed(2)}
                  </span>
                )}
                {tradePrice !== null && (
                  <span
                    className="text-[11px] font-bold px-1.5 py-0.5 rounded bg-yellow-400/20 text-yellow-300 border border-yellow-500/40"
                    title={`Trade price (${tradePct}% off)`}
                  >
                    Trade ${tradePrice.toFixed(2)}
                  </span>
                )}
              </div>
              <p className="text-xs text-gray-500">
                Stock: {product.stockQty}
              </p>
            </div>
          </button>
          );
        })}
      </div>
    </div>
  );
}
