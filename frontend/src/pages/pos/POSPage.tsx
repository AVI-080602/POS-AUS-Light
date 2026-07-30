import { useState, useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useLocation } from 'react-router-dom';
import toast from 'react-hot-toast';
import { MagnifyingGlassIcon, XMarkIcon, ChevronLeftIcon, ChevronRightIcon, PlusCircleIcon, PrinterIcon } from '@heroicons/react/24/outline';
import { RootState, AppDispatch } from '../../store';
import { ordersApi } from '../../services/api';
import { buildInvoiceData } from '../../utils/orderInvoice';
import InvoiceModal from './components/InvoiceModal';
import {
  fetchProducts,
  fetchCategories,
  fetchSubcategories,
  isProductOnSale,
  effectiveProductPrice,
} from '../../store/slices/productsSlice';
import { productsApi, quotesApi } from '../../services/api';
import {
  addItem,
  removeItem,
  updateQuantity,
  clearCart,
  setItemDiscount,
  setItemUnitPrice,
  setCartDiscount,
  setCustomer,
  setTradeAutoDiscounts,
  setExchangeContext,
} from '../../store/slices/cartSlice';
import ProductGrid from './components/ProductGrid';
import CartPanel from './components/CartPanel';
import PaymentModal from './components/PaymentModal';
import ProductDetailModal from './components/ProductDetailModal';
import OrderReviewModal, { OrderReviewSelections } from './components/OrderReviewModal';
import StripCutModal from './components/StripCutModal';

// View mode: categories → subcategories → products
type ViewMode = 'categories' | 'subcategories' | 'products';

export default function POSPage() {
  const dispatch = useDispatch<AppDispatch>();
  const location = useLocation();

  // If navigated here from the Customer Card "Create Order" button,
  // pre-select that customer in the cart on mount.
  useEffect(() => {
    const preselect = (location.state as any)?.preselectCustomer;
    if (preselect?.id) {
      dispatch(
        setCustomer({
          id: preselect.id,
          name: preselect.name,
          isTrade: !!preselect.isTrade,
        }),
      );
    }
    // Exchange: arriving from a refund-and-exchange on the Orders page.
    const ex = (location.state as any)?.exchangeFromOrder;
    if (ex?.id) {
      dispatch(
        setExchangeContext({ orderId: ex.id, orderNumber: ex.orderNumber }),
      );
    }
    if (preselect?.id || ex?.id) {
      // Clear location state so a later navigation doesn't re-apply
      window.history.replaceState({}, document.title);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const {
    items: products,
    categories,
    subcategories,
    isLoading,
    pagination,
  } = useSelector((state: RootState) => state.products);
  const cart = useSelector((state: RootState) => state.cart);
  const { user } = useSelector((state: RootState) => state.auth);

  // Get user's discount permissions
  const maxDiscountPercent = user?.role?.maxDiscountPercent ?? 0;
  const canStackDiscounts = user?.role?.canStackDiscounts ?? false;
  // Trade customers bypass the role-based cap entirely — the only guard
  // for them is the "below cost price" warning rendered per-line in the
  // cart, not a hard discount ceiling.
  const effectiveMaxDiscountPercent = cart.customerIsTrade
    ? 100
    : maxDiscountPercent;

  const [searchQuery, setSearchQuery] = useState('');
  const [showPayment, setShowPayment] = useState(false);
  // Order Review step between the cart and payment — wide, full-screen
  // view of every line with per-line Backorder / Lay-by toggles. The
  // selections made here seed the PaymentModal so the cashier doesn't
  // have to re-pick them in the narrow sidebar.
  const [showReview, setShowReview] = useState(false);
  const [reviewSelections, setReviewSelections] = useState<OrderReviewSelections | null>(null);
  const [detailProduct, setDetailProduct] = useState<any>(null);
  const [showCustomItem, setShowCustomItem] = useState(false);
  // LED Strip Lights calculator modal — opened from a virtual category
  // tile on the home screen; on Send, each strip line is pushed into
  // the main cart as a custom item.
  const [showStripCut, setShowStripCut] = useState(false);
  const [customItemName, setCustomItemName] = useState('');
  const [customItemPrice, setCustomItemPrice] = useState('');
  const [customItemSku, setCustomItemSku] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 48;

  // Trade auto-discount % per visible product, used to show a yellow
  // "Trade $X" tag beside the retail price on each grid card.
  const [tradePctMap, setTradePctMap] = useState<Record<number, number>>({});

  // "Last Invoice" quick re-print — pulls the most recently created
  // order and opens its printable invoice without leaving the POS.
  const [invoiceData, setInvoiceData] = useState<any>(null);
  const showLastInvoice = async () => {
    try {
      const r = await ordersApi.getOrders({ page: 1, limit: 1 });
      const last = r.data?.data?.orders?.[0];
      if (!last) {
        toast.error('No recent orders found');
        return;
      }
      const full = await ordersApi.getOrder(last.id);
      const o = full.data?.data?.order;
      if (!o) {
        toast.error('Could not load the last invoice');
        return;
      }
      setInvoiceData(buildInvoiceData(o));
    } catch {
      toast.error('Could not load the last invoice');
    }
  };

  const [viewMode, setViewMode] = useState<ViewMode>('categories');
  const [activeCategoryId, setActiveCategoryId] = useState<number | null>(null);
  const [activeCategoryName, setActiveCategoryName] = useState<string>('');

  // Search bar dropdowns
  const [searchCatId, setSearchCatId] = useState<string>('');
  const [searchSubcatId, setSearchSubcatId] = useState<string>('');
  const [searchSubcats, setSearchSubcats] = useState<any[]>([]);
  const [loadingSearchSubcats, setLoadingSearchSubcats] = useState(false);
  // Optional third-level dropdown — only appears if the selected
  // subcategory has children of its own (e.g. Fans → DC Ceiling Fans →
  // With Light / Without Light). When the subcategory is a leaf, this
  // stays empty and the user goes straight to products.
  const [searchSubsubcatId, setSearchSubsubcatId] = useState<string>('');
  const [searchSubsubcats, setSearchSubsubcats] = useState<any[]>([]);
  const [loadingSearchSubsubcats, setLoadingSearchSubsubcats] = useState(false);

  // Default: hide out-of-stock items (treated as discontinued). Admin/
  // manager can flip this on if they need to see them (e.g. to audit or
  // to backorder a specific SKU they know exists but is currently OOS).
  const [showOutOfStock, setShowOutOfStock] = useState(false);
  const canToggleOutOfStock =
    user?.role?.name === 'admin' || user?.role?.name === 'manager';

  useEffect(() => {
    dispatch(fetchCategories());
  }, [dispatch]);

  // Fetch subcategories for search dropdown when category changes
  useEffect(() => {
    if (!searchCatId) {
      setSearchSubcats([]);
      setSearchSubcatId('');
      setSearchSubsubcats([]);
      setSearchSubsubcatId('');
      return;
    }
    setSearchSubcatId('');
    setSearchSubsubcats([]);
    setSearchSubsubcatId('');
    setLoadingSearchSubcats(true);
    productsApi.getSubcategories(Number(searchCatId))
      .then(res => {
        const data = res.data?.data || res.data;
        setSearchSubcats(data?.subcategories || []);
      })
      .catch(() => setSearchSubcats([]))
      .finally(() => setLoadingSearchSubcats(false));
  }, [searchCatId]);

  // Fetch 3rd-level subcategories when a subcategory is picked.
  useEffect(() => {
    if (!searchSubcatId) {
      setSearchSubsubcats([]);
      setSearchSubsubcatId('');
      return;
    }
    setSearchSubsubcatId('');
    setLoadingSearchSubsubcats(true);
    productsApi.getSubcategories(Number(searchSubcatId))
      .then(res => {
        const data = res.data?.data || res.data;
        setSearchSubsubcats(data?.subcategories || []);
      })
      .catch(() => setSearchSubsubcats([]))
      .finally(() => setLoadingSearchSubsubcats(false));
  }, [searchSubcatId]);

  // Fetch products only when in product view or searching via dropdowns
  useEffect(() => {
    // If searching via dropdowns, category is required
    if (searchCatId) {
      // If subcats exist but none selected, don't fetch yet
      if (searchSubcats.length > 0 && !searchSubcatId) return;
      // Same gate at the 3rd level: if the selected subcategory has
      // children, wait for the user to pick one before showing products.
      if (
        searchSubcatId &&
        searchSubsubcats.length > 0 &&
        !searchSubsubcatId
      )
        return;

      // Pick the deepest selected category id for the products query
      const categoryId = searchSubsubcatId
        ? Number(searchSubsubcatId)
        : searchSubcatId
          ? Number(searchSubcatId)
          : Number(searchCatId);

      const timer = setTimeout(() => {
        dispatch(
          fetchProducts({
            search: searchQuery || undefined,
            category: categoryId,
            limit: pageSize,
            page: currentPage,
            inStock: showOutOfStock ? undefined : true,
          })
        );
      }, 300);
      return () => clearTimeout(timer);
    }

    // Normal tile navigation
    if (viewMode !== 'products') return;

    const timer = setTimeout(() => {
      dispatch(
        fetchProducts({
          search: searchQuery || undefined,
          category: activeCategoryId || undefined,
          limit: pageSize,
          page: currentPage,
          inStock: showOutOfStock ? undefined : true,
        })
      );
    }, 300);

    return () => clearTimeout(timer);
  }, [searchQuery, activeCategoryId, viewMode, currentPage, dispatch, searchCatId, searchSubcatId, searchSubcats.length, searchSubsubcatId, searchSubsubcats.length, showOutOfStock]);

  // Reset page on filter change
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, activeCategoryId, searchCatId, searchSubcatId, searchSubsubcatId]);

  // When search dropdowns are used, switch to products view
  useEffect(() => {
    if (searchCatId) {
      setViewMode('products');
      setActiveCategoryId(null);
    }
  }, [searchCatId, searchSubcatId, searchSubsubcatId]);

  // Typing in the search box searches across ALL products — no category
  // required (Sally: "often we don't know the category"). As soon as the
  // cashier types (and no category dropdown is active) switch to the
  // products grid; the fetch effect then queries with category=undefined.
  // Clearing the box with no category active returns to the tile view.
  useEffect(() => {
    if (searchCatId) return; // dropdown flow manages its own view
    if (searchQuery.trim().length >= 1) {
      if (viewMode !== 'products') {
        setViewMode('products');
        setActiveCategoryId(null);
      }
    } else if (viewMode === 'products' && !activeCategoryId) {
      setViewMode('categories');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery, searchCatId]);

  // Fetch the trade auto-discount for products currently visible on the
  // grid AND for anything sitting in the cart, so both the grid cards
  // and the cart line items can display the yellow "Trade $X" tag.
  // Fires whenever the visible product set or the cart changes.
  const cartProductIdsKey = cart.items
    .map((i) => i.productId)
    .sort()
    .join(',');
  const gridProductIdsKey = products
    .map((p) => p.id)
    .filter((id) => Number.isFinite(id) && id > 0)
    .join(',');
  useEffect(() => {
    const gridIds = products
      .map((p) => p.id)
      .filter((id) => Number.isFinite(id) && id > 0);
    const cartIds = cart.items
      .map((it) => it.productId)
      .filter((id) => Number.isFinite(id) && id > 0);
    const ids = Array.from(new Set([...gridIds, ...cartIds]));
    if (ids.length === 0) {
      setTradePctMap({});
      return;
    }
    let cancelled = false;
    quotesApi
      .tradeDiscountPreview(ids)
      .then((r) => {
        if (cancelled) return;
        const discounts = r.data?.data?.discounts || {};
        const map: Record<number, number> = {};
        for (const [pid, info] of Object.entries(discounts)) {
          const pct = (info as any)?.percent || 0;
          if (pct > 0) map[Number(pid)] = pct;
        }
        setTradePctMap(map);
      })
      .catch(() => {
        // Non-essential — cards just won't show the trade tag.
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gridProductIdsKey, cartProductIdsKey]);

  // Trade auto-discount: when the cart is for a trade-flagged customer
  // and the set of productIds changes, fetch the per-line auto rate
  // from the backend and apply it. Cart math then uses max(manual,
  // auto) per line. When the customer is cleared (or non-trade), the
  // setCustomer reducer already wipes any previously-applied auto.
  // (cartProductIdsKey is declared above and shared with the badge-pct fetch.)
  useEffect(() => {
    if (!cart.customerIsTrade) return;
    const ids = cart.items
      .map((i) => i.productId)
      .filter((id) => Number.isFinite(id) && id > 0);
    if (ids.length === 0) return;
    let cancelled = false;
    quotesApi
      .tradeDiscountPreview(ids)
      .then((r) => {
        if (cancelled) return;
        const map = r.data?.data?.discounts || {};
        dispatch(setTradeAutoDiscounts(map));
      })
      .catch(() => {
        // Non-essential — server re-applies on order create.
      });
    return () => {
      cancelled = true;
    };
  }, [cart.customerIsTrade, cartProductIdsKey, dispatch]);

  const handleCategorySelect = (cat: { id: number; name: string }) => {
    setActiveCategoryId(cat.id);
    setActiveCategoryName(cat.name);
    dispatch(fetchSubcategories(cat.id));
    setViewMode('subcategories');
  };

  const handleSubcategorySelect = async (subcat: { id: number; name: string }) => {
    setActiveCategoryId(subcat.id);
    setActiveCategoryName(subcat.name);
    // If this subcategory has its own children (3rd-level / leaf categories),
    // stay in the subcategories view and show them. Only drop into the
    // products view once we've reached a leaf with no further children.
    try {
      const result: any = await dispatch(fetchSubcategories(subcat.id)).unwrap();
      const children =
        result?.subcategories || result?.data?.subcategories || [];
      if (children.length > 0) {
        setViewMode('subcategories');
        return;
      }
    } catch {
      // Ignore — fall through to products view
    }
    setViewMode('products');
    dispatch(
      fetchProducts({
        category: subcat.id,
        limit: pageSize,
        page: 1,
        inStock: showOutOfStock ? undefined : true,
      })
    );
  };

  const handleBackToCategories = () => {
    setViewMode('categories');
    setActiveCategoryId(null);
    setActiveCategoryName('');
    setSearchQuery('');
  };

  const handleBackToSubcategories = () => {
    // Go back to the parent category's subcategories
    const parentCat = categories.find(c =>
      c.id === activeCategoryId || c.children?.some(sc => sc.id === activeCategoryId)
    );
    if (parentCat) {
      setActiveCategoryId(parentCat.id);
      setActiveCategoryName(parentCat.name);
      dispatch(fetchSubcategories(parentCat.id));
    }
    setViewMode('subcategories');
  };

  const handleViewAllProducts = () => {
    setActiveCategoryId(null);
    setActiveCategoryName('');
    setViewMode('products');
    dispatch(
      fetchProducts({
        limit: pageSize,
        page: 1,
        inStock: showOutOfStock ? undefined : true,
      }),
    );
  };

  const handleAddToCart = (product: any, quantity: number = 1) => {
    const alreadyInCart = cart.items.some((i) => i.productId === product.id);
    if (alreadyInCart) {
      toast(`"${product.name}" is already in the cart — quantity increased`, { icon: 'ℹ️' });
    }
    // If the product was out of stock at add time, pre-flag it as a
    // backorder line so the cashier sees the checkbox already ticked
    // at checkout. They can still untick it if they manually pulled
    // stock from somewhere.
    const outOfStock =
      product.isInStock === false || Number(product.stockQty) <= 0;
    const onSale = isProductOnSale(product);
    // For trade customers, always use the FIXED RETAIL price as the base
    // so the auto trade discount doesn't stack on top of a sale price.
    // For retail customers, use the sale price when active.
    const unitPrice = cart.customerIsTrade
      ? Number(product.price)
      : effectiveProductPrice(product);
    for (let i = 0; i < quantity; i++) {
      dispatch(
        addItem({
          productId: product.id,
          sku: product.sku,
          name: product.name,
          price: unitPrice,
          imageUrl: product.thumbnailUrl,
          isSaleItem: onSale,
          isBackorder: outOfStock,
        })
      );
    }
  };

  const handleAddCustomItem = () => {
    const price = parseFloat(customItemPrice);
    if (!customItemName.trim() || isNaN(price) || price <= 0) return;
    dispatch(
      addItem({
        productId: -Date.now(),
        sku: customItemSku.trim() || 'CUSTOM',
        name: customItemName.trim(),
        price,
      })
    );
    setShowCustomItem(false);
    setCustomItemName('');
    setCustomItemPrice('');
    setCustomItemSku('');
  };

  const handleCheckout = () => {
    if (cart.items.length === 0) return;
    // Keep any prior review picks so hitting Back and coming back
    // doesn't wipe backorder / lay-by ticks the cashier already made.
    // reviewSelections is reset when the cart is cleared or the order
    // completes.
    setShowReview(true);
  };

  // Cost map keyed by productId — feeds the cart's "below cost" warning
  // for trade customers. Only includes products in the currently visible
  // grid, so a cart item carried over from a previous page won't trigger
  // the warning until you navigate back. Good enough for v1.
  const costMap = products.reduce((acc, product) => {
    if (product.cost != null) acc[product.id] = product.cost;
    return acc;
  }, {} as Record<number, number>);
  // Stock-quantity enforcement is paused for now — CartPanel receives an
  // empty stockMap so the "Only X in stock" warnings stay quiet. Restore
  // by building a productId→stockQty map here and passing it through.

  return (
    <div className="flex h-full">
      {/* Main Panel */}
      <div className="flex-1 min-w-0 flex flex-col p-4">
        {/* Exchange banner — this sale replaces a returned item. */}
        {cart.exchangeFromOrderNumber && (
          <div className="mb-3 flex items-center justify-between rounded-lg border border-cyan-500/40 bg-cyan-500/10 px-4 py-2 text-sm">
            <span className="text-cyan-200">
              Exchange for order{' '}
              <span className="font-bold">{cart.exchangeFromOrderNumber}</span>
              {' '}— store credit from the return can be applied at payment.
            </span>
            <button
              className="text-cyan-300 hover:text-white text-xs underline"
              onClick={() => dispatch(setExchangeContext(null))}
            >
              Cancel exchange
            </button>
          </div>
        )}
        {/* Search Bar with Category/Subcategory dropdowns */}
        <div className="flex gap-2 mb-4">
          {/* Category dropdown (required) */}
          <select
            className="input w-48 shrink-0"
            value={searchCatId}
            onChange={(e) => {
              setSearchCatId(e.target.value);
              if (!e.target.value) {
                setViewMode('categories');
                setActiveCategoryId(null);
                setSearchQuery('');
              }
            }}
          >
            <option value="">All Categories</option>
            {categories.map((cat) => (
              <option key={cat.id} value={cat.id}>{cat.name}</option>
            ))}
          </select>

          {/* Subcategory dropdown (required if subcats exist) */}
          {searchCatId && (
            <select
              className="input w-48 shrink-0"
              value={searchSubcatId}
              onChange={(e) => setSearchSubcatId(e.target.value)}
              disabled={loadingSearchSubcats}
            >
              <option value="">
                {loadingSearchSubcats ? 'Loading...' : searchSubcats.length > 0 ? 'Select Subcategory *' : 'No subcategories'}
              </option>
              {searchSubcats.map((sc: any) => (
                <option key={sc.id} value={sc.id}>{sc.name}</option>
              ))}
            </select>
          )}

          {/* Third-level dropdown — only appears if the chosen subcategory
              has children of its own. Otherwise the user goes straight to
              products with the subcategory as the deepest filter. */}
          {searchSubcatId && (loadingSearchSubsubcats || searchSubsubcats.length > 0) && (
            <select
              className="input w-48 shrink-0"
              value={searchSubsubcatId}
              onChange={(e) => setSearchSubsubcatId(e.target.value)}
              disabled={loadingSearchSubsubcats}
            >
              <option value="">
                {loadingSearchSubsubcats ? 'Loading...' : 'Select Type *'}
              </option>
              {searchSubsubcats.map((sc: any) => (
                <option key={sc.id} value={sc.id}>{sc.name}</option>
              ))}
            </select>
          )}

          {/* Text search (optional) */}
          <div className="relative flex-1">
            <MagnifyingGlassIcon className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
            <input
              type="text"
              placeholder="Search any product by name, SKU, or barcode..."
              className="input pl-12 pr-10"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button
                className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white"
                onClick={() => setSearchQuery('')}
              >
                <XMarkIcon className="h-5 w-5" />
              </button>
            )}
          </div>

          {/* Clear all filters */}
          {searchCatId && (
            <button
              className="btn-sm bg-gray-700 text-gray-300 whitespace-nowrap px-3 hover:bg-gray-600"
              onClick={() => {
                setSearchCatId('');
                setSearchSubcatId('');
                setSearchSubsubcatId('');
                setSearchQuery('');
                setViewMode('categories');
                setActiveCategoryId(null);
              }}
            >
              <XMarkIcon className="h-4 w-4" />
            </button>
          )}

          <button
            className="btn-sm bg-purple-600 text-white whitespace-nowrap flex items-center gap-1 px-4"
            onClick={() => setShowCustomItem(true)}
          >
            <PlusCircleIcon className="h-5 w-5" />
            Custom Item
          </button>

          <button
            className="btn-sm bg-pos-accent text-gray-200 whitespace-nowrap flex items-center gap-1 px-4 hover:bg-pos-bg"
            onClick={showLastInvoice}
            title="Reprint the most recently completed invoice"
          >
            <PrinterIcon className="h-5 w-5" />
            Last Invoice
          </button>

          {canToggleOutOfStock && (
            <label
              className="flex items-center gap-2 text-xs text-gray-400 whitespace-nowrap cursor-pointer px-2"
              title="Out-of-stock items are hidden by default (treated as discontinued). Toggle to surface them for auditing or backorder lookup."
            >
              <input
                type="checkbox"
                checked={showOutOfStock}
                onChange={(e) => setShowOutOfStock(e.target.checked)}
                className="w-4 h-4"
              />
              Show discontinued
            </label>
          )}
        </div>

        {/* Navigation breadcrumb */}
        {viewMode !== 'categories' && !searchCatId && (
          <div className="flex items-center gap-2 mb-4 text-sm">
            <button
              className="text-gray-400 hover:text-white flex items-center gap-1"
              onClick={handleBackToCategories}
            >
              <ChevronLeftIcon className="h-4 w-4" />
              Categories
            </button>
            {viewMode === 'products' && activeCategoryName && (
              <>
                <span className="text-gray-600">/</span>
                <button
                  className="text-gray-400 hover:text-white"
                  onClick={handleBackToSubcategories}
                >
                  {activeCategoryName}
                </button>
              </>
            )}
          </div>
        )}

        {/* CATEGORIES VIEW */}
        {viewMode === 'categories' && !searchCatId && (
          <div className="flex-1 overflow-y-auto">
            <div className="grid grid-cols-4 gap-4">
              {/* All Products tile */}
              <button
                className="bg-gradient-to-br from-primary-600 to-primary-800 rounded-xl p-6 text-center hover:from-primary-500 hover:to-primary-700 transition-all shadow-lg"
                onClick={handleViewAllProducts}
              >
                <div className="text-white font-semibold text-lg">All Products</div>
              </button>
              {/* Virtual tile — opens the cut-to-length LED strip
                  calculator instead of a normal product list. Kept
                  next to All Products so it's easy to find. */}
              <button
                className="bg-gradient-to-br from-amber-500 to-amber-700 rounded-xl p-6 text-center hover:from-amber-400 hover:to-amber-600 transition-all shadow-lg"
                onClick={() => setShowStripCut(true)}
              >
                <div className="text-white font-semibold text-lg">LED Strip Lights</div>
              </button>
              {categories.map((cat) => (
                <button
                  key={cat.id}
                  className="bg-gradient-to-br from-pos-accent to-gray-800 rounded-xl p-6 text-center hover:from-gray-600 hover:to-gray-700 transition-all shadow-lg border border-gray-700"
                  onClick={() => handleCategorySelect(cat)}
                >
                  <div className="text-white font-semibold text-lg">{cat.name}</div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* SUBCATEGORIES VIEW */}
        {viewMode === 'subcategories' && !searchCatId && (
          <div className="flex-1 overflow-y-auto">
            <h2 className="text-lg font-bold text-white mb-4">{activeCategoryName}</h2>
            <div className="grid grid-cols-4 gap-4">
              {/* All in this category tile */}
              <button
                className="bg-gradient-to-br from-primary-600 to-primary-800 rounded-xl p-6 text-center hover:from-primary-500 hover:to-primary-700 transition-all shadow-lg"
                onClick={() => {
                  setViewMode('products');
                  dispatch(
                    fetchProducts({
                      category: activeCategoryId!,
                      limit: pageSize,
                      page: 1,
                      inStock: showOutOfStock ? undefined : true,
                    }),
                  );
                }}
              >
                <div className="text-white font-semibold text-lg">All {activeCategoryName}</div>
              </button>
              {subcategories.map((subcat) => (
                <button
                  key={subcat.id}
                  className="bg-gradient-to-br from-pos-accent to-gray-800 rounded-xl p-6 text-center hover:from-gray-600 hover:to-gray-700 transition-all shadow-lg border border-gray-700"
                  onClick={() => handleSubcategorySelect(subcat)}
                >
                  <div className="text-white font-semibold text-lg">{subcat.name}</div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Waiting for subcategory selection or loading subcats */}
        {searchCatId && loadingSearchSubcats && (
          <div className="flex-1 flex items-center justify-center">
            <p className="text-gray-400 text-lg">Loading subcategories...</p>
          </div>
        )}
        {searchCatId && !loadingSearchSubcats && searchSubcats.length > 0 && !searchSubcatId && (
          <div className="flex-1 flex items-center justify-center">
            <p className="text-gray-400 text-lg">Please select a subcategory to view products</p>
          </div>
        )}
        {searchSubcatId && !loadingSearchSubsubcats && searchSubsubcats.length > 0 && !searchSubsubcatId && (
          <div className="flex-1 flex items-center justify-center">
            <p className="text-gray-400 text-lg">Please select a type to view products</p>
          </div>
        )}

        {/* PRODUCTS VIEW */}
        {(viewMode === 'products' || searchCatId) && !loadingSearchSubcats && !loadingSearchSubsubcats && !(searchCatId && searchSubcats.length > 0 && !searchSubcatId) && !(searchSubcatId && searchSubsubcats.length > 0 && !searchSubsubcatId) && (
          <>
            <ProductGrid
              products={products}
              isLoading={isLoading}
              onSelect={(p) => setDetailProduct(p)}
              tradePctMap={tradePctMap}
              saleBadgeLabel={
                /clearance/i.test(activeCategoryName)
                  ? 'WAREHOUSE CLEARANCE'
                  : 'SALE'
              }
            />

            {pagination.totalPages > 1 && (
              <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-700">
                <div className="text-sm text-gray-400">
                  Showing {((currentPage - 1) * pageSize) + 1}-{Math.min(currentPage * pageSize, pagination.total)} of {pagination.total} products
                </div>
                <div className="flex items-center gap-2">
                  <button
                    className="btn-sm bg-pos-accent text-gray-300 disabled:opacity-50 disabled:cursor-not-allowed"
                    onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                    disabled={currentPage === 1}
                  >
                    <ChevronLeftIcon className="h-4 w-4" />
                  </button>
                  <span className="text-sm text-gray-300 px-2">
                    Page {currentPage} of {pagination.totalPages}
                  </span>
                  <button
                    className="btn-sm bg-pos-accent text-gray-300 disabled:opacity-50 disabled:cursor-not-allowed"
                    onClick={() => setCurrentPage(p => Math.min(pagination.totalPages, p + 1))}
                    disabled={currentPage === pagination.totalPages}
                  >
                    <ChevronRightIcon className="h-4 w-4" />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Cart Panel */}
      <CartPanel
        items={cart.items}
        tradePctMap={tradePctMap}
        subtotal={cart.subtotal}
        discount={cart.itemDiscounts + cart.cartDiscountAmount}
        tax={cart.taxAmount}
        total={cart.grandTotal}
        customerName={cart.customerName}
        cartDiscount={cart.cartDiscount}
        maxDiscountPercent={effectiveMaxDiscountPercent}
        canStackDiscounts={canStackDiscounts}
        stockMap={{}}
        costMap={costMap}
        onRemoveItem={(productId) => dispatch(removeItem(productId))}
        onUpdateQuantity={(productId, qty) =>
          dispatch(updateQuantity({ productId, quantity: qty }))
        }
        onSetItemDiscount={(productId, discountPercent) =>
          dispatch(setItemDiscount({ productId, discountPercent }))
        }
        onSetItemUnitPrice={(productId, unitPrice) =>
          dispatch(setItemUnitPrice({ productId, unitPrice }))
        }
        onSetCartDiscount={(discount) => dispatch(setCartDiscount(discount))}
        onSetCustomer={(customer) => dispatch(setCustomer(customer))}
        onClearCart={() => dispatch(clearCart())}
        onCheckout={handleCheckout}
      />

      {/* Order Review — full-screen confirmation step before payment.
          Wide table of all lines, per-line Backorder / Lay-by toggles. */}
      {showReview && (
        <OrderReviewModal
          items={cart.items}
          subtotal={cart.subtotal}
          discount={cart.itemDiscounts + cart.cartDiscountAmount}
          tax={cart.taxAmount}
          total={cart.grandTotal}
          initialSelections={reviewSelections || undefined}
          onBack={() => setShowReview(false)}
          onContinue={(sel) => {
            setReviewSelections(sel);
            setShowReview(false);
            setShowPayment(true);
          }}
        />
      )}

      {/* Payment Modal */}
      {showPayment && (
        <PaymentModal
          total={cart.grandTotal}
          initialSelections={reviewSelections || undefined}
          onClose={() => setShowPayment(false)}
          onComplete={() => {
            setShowPayment(false);
            dispatch(clearCart());
          }}
        />
      )}

      {/* Strip Cut Counter — cut-to-length LED strip calculator. On
          Send, each order line is pushed into the main cart as a custom
          item (negative productId, same code path as Custom Item). */}
      {showStripCut && (
        <StripCutModal
          onClose={() => setShowStripCut(false)}
          onSendToCart={(lines) => {
            lines.forEach((l, i) => {
              dispatch(
                addItem({
                  productId: -(Date.now() + i),
                  sku: l.sku,
                  name: l.name,
                  price: l.price,
                }),
              );
            });
          }}
        />
      )}

      {/* Product Detail Modal */}
      {detailProduct && (
        <ProductDetailModal
          productId={detailProduct.id}
          fallbackProduct={detailProduct}
          tradePctMap={tradePctMap}
          onClose={() => setDetailProduct(null)}
          onAddToCart={(p, q) => handleAddToCart(p, q)}
        />
      )}

      {/* Last-invoice re-print */}
      {invoiceData && (
        <InvoiceModal invoice={invoiceData} onClose={() => setInvoiceData(null)} />
      )}

      {/* Custom Item Modal */}
      {showCustomItem && (
        <div className="modal-backdrop" onClick={() => setShowCustomItem(false)}>
          <div className="modal-content max-w-sm" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold">Add Custom Item</h3>
              <button className="text-gray-400 hover:text-white" onClick={() => setShowCustomItem(false)}>
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-3 mb-4">
              <div>
                <label className="block text-xs text-gray-400 mb-1">Item Name *</label>
                <input
                  type="text"
                  className="input"
                  placeholder="e.g. Custom Light Fitting"
                  value={customItemName}
                  onChange={(e) => setCustomItemName(e.target.value)}
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Price (incl. GST) *</label>
                <input
                  type="number"
                  className="input"
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
                  className="input"
                  placeholder="CUSTOM-001"
                  value={customItemSku}
                  onChange={(e) => setCustomItemSku(e.target.value)}
                />
              </div>
            </div>
            <button
              className="btn-primary w-full"
              onClick={handleAddCustomItem}
              disabled={!customItemName.trim() || !customItemPrice || parseFloat(customItemPrice) <= 0}
            >
              Add to Cart
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
