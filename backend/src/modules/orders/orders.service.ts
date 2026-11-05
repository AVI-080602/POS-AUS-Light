import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, Brackets, WhereExpressionBuilder, EntityManager } from 'typeorm';
import {
  Order,
  OrderItem,
  OrderEvent,
  OrderStatus,
  OrderType,
  PaymentStatus,
  OrderSyncStatus,
  OrderSource,
} from './entities';
import { User } from '../users/entities/user.entity';
import { DeliveryType, DELIVERY_FEES } from './entities/order.entity';
import { Payment, PaymentMethod, PaymentEntityStatus } from '../payments/entities/payment.entity';
import { ProductsService } from '../products/products.service';
import { TradeDiscountsService } from '../products/trade-discounts.service';
import { Customer } from '../customers/entities/customer.entity';
import { DiscountsService, UserRole } from '../discounts/discounts.service';
import { DiscountType } from '../discounts/entities';
import { ConfigService } from '@nestjs/config';
import { StoreCreditService } from '../customers/store-credit.service';
import { SyncService } from '../sync/sync.service';
import { SettingsService } from '../settings/settings.service';

interface CreateOrderDto {
  customerId?: number;
  // Cashier-driven trade flag from the PaymentModal Trade button. When
  // true, the server applies the trade auto-discount even if the
  // selected customer doesn't have isTrade=true (or there's no
  // customer at all — walk-in trade buyer). Combined with the
  // customer.isTrade flag via OR.
  isTradeOrder?: boolean;
  // When true, per-item `unitPrice` overrides are honoured even for
  // non-backorder lines. Used by the quote-conversion path so locked-in
  // quoted prices (especially trade prices) flow through to the order.
  // Untrusted callers (POS PaymentModal) should leave this unset — the
  // discount flow is how cashiers adjust prices on normal sales.
  trustItemUnitPrices?: boolean;
  items: Array<{
    productId: number;
    quantity: number;
    discountPercent?: number;
    // Mark a line as a backorder. Skips the stock availability check and
    // doesn't deduct inventory. Stock is decremented when the manager
    // marks the item as fulfilled.
    isBackorder?: boolean;
    // Partial-backorder split. When `isBackorder` is true and
    // `backorderQty` is set to a value less than `quantity`, the server
    // splits the line into two order_items: a take-now item with qty
    // `quantity - backorderQty` and a backorder item with qty
    // `backorderQty`. Default = full quantity (entire line is backorder).
    backorderQty?: number;
    // Mark a line as held by the store on a layby. Stock IS deducted
    // (reserved) but the customer doesn't take the item home until the
    // layby balance is paid in full. Enables a single order to mix
    // take-now items with layby-held items.
    isLaybyHeld?: boolean;
    // Partial-layby split. When `isLaybyHeld` is true and `laybyHeldQty`
    // is set to a value less than `quantity`, the server splits the
    // line into two order_items: a take-now item with qty
    // `quantity - laybyHeldQty` and a held item with qty `laybyHeldQty`.
    // Default = full quantity (entire line is held).
    laybyHeldQty?: number;
    // Manual unit price override. Honoured for backorder lines and for
    // lines the cashier explicitly re-priced (priceEdited) — staff may
    // change the actual price, including SALE/clearance items, with the
    // cost+30% floor as the guard (hard block for sales staff).
    unitPrice?: number;
    // Cashier changed the actual price on this line at the till.
    priceEdited?: boolean;
    // Custom / one-off line item that isn't in the product catalogue
    // (e.g. cashier's "Custom Item" button, or a cut-to-length LED
    // strip). productId will be <= 0 (a client-generated negative
    // timestamp) and `sku`, `name`, `unitPrice` MUST be supplied on
    // the DTO — the server won't look up a product row.
    isCustom?: boolean;
    sku?: string;
    name?: string;
    // Brand / supplier picked for a custom item (Sally, 20 Oct 2026), so
    // its back order lands under the right supplier.
    supplier?: string;
  }>;
  cartDiscount?: {
    type: 'percent' | 'fixed';
    value: number;
    reason?: string;
  };
  payments: Array<{
    method: string;
    amount: number;
    reference?: string;
    amountTendered?: number;
  }>;
  notes?: string;
  // Staff-only note (never printed on the invoice).
  internalNotes?: string;
  // Optional name to snapshot on walk-in orders that have no customer FK.
  // Ignored when customerId is set.
  customerName?: string;
  // Layby options. When `orderType === 'layby'`, the sum of payments
  // is treated as a deposit rather than the full grand total. The
  // remainder is owed by the customer and collected via
  // `takeLaybyPayment`. `laybyExpiresAt` is when the balance must be
  // paid by; defaults to now + laybyMaxDays (settings).
  orderType?: 'standard' | 'layby';
  laybyExpiresAt?: string;
  // Pickup vs delivery method. Pickup is free; delivery / local_metro /
  // austpost each have a fixed fee set in DELIVERY_FEES. Defaults to
  // pickup when omitted.
  deliveryType?: 'pickup' | 'delivery' | 'local_metro' | 'austpost' | 'custom';
  // Only honoured when deliveryType is 'custom' — the cashier-entered
  // fee. Every other type takes its fee from DELIVERY_FEES.
  deliveryFee?: number;
  // Optional delivery region flag — 'local' vs 'interstate'. Used by
  // the warehouse for dispatch routing; doesn't change the fee.
  deliveryRegion?: 'local' | 'interstate' | null;
  // When this order is the replacement half of an exchange, the id of
  // the original order whose item(s) were returned. Cross-links the two.
  exchangeFromOrderId?: number;
}

@Injectable()
export class OrdersService {
  private readonly taxRate: number;

  constructor(
    @InjectRepository(Order)
    private readonly orderRepository: Repository<Order>,
    @InjectRepository(OrderItem)
    private readonly orderItemRepository: Repository<OrderItem>,
    @InjectRepository(OrderEvent)
    private readonly orderEventRepository: Repository<OrderEvent>,
    @InjectRepository(Customer)
    private readonly customerRepository: Repository<Customer>,
    private readonly productsService: ProductsService,
    private readonly tradeDiscounts: TradeDiscountsService,
    private readonly discountsService: DiscountsService,
    private readonly configService: ConfigService,
    private readonly dataSource: DataSource,
    private readonly storeCreditService: StoreCreditService,
    private readonly syncService: SyncService,
    private readonly settingsService: SettingsService,
  ) {
    this.taxRate = parseFloat(
      this.configService.get<string>('TAX_RATE', '0.10'),
    );
  }

  // Trade pricing kicks in when EITHER:
  //   - the cashier explicitly flagged the order as trade in the
  //     PaymentModal (dto.isTradeOrder), e.g. for a walk-in trade
  //     buyer with no customer record, OR
  //   - the selected customer is permanently flagged isTrade=true.
  // Returns false otherwise (walk-in retail, non-trade customer).
  private async isTradeCustomerOrder(dto: CreateOrderDto): Promise<boolean> {
    if (dto.isTradeOrder) return true;
    if (!dto.customerId) return false;
    const c = await this.customerRepository.findOne({
      where: { id: dto.customerId },
      select: ['id', 'isTrade'],
    });
    return !!c?.isTrade;
  }

  async create(
    dto: CreateOrderDto,
    userId: number,
    userRole: UserRole,
  ): Promise<Order> {
    // Fetch products. When the order is for a trade customer (and we
    // haven't been handed locked-in prices via the quote-conversion
    // path), we need product.categories loaded so the trade-rule
    // engine can decide which auto-discount applies per line.
    const isTradeOrder = await this.isTradeCustomerOrder(dto);
    // Custom items carry a negative client-generated productId and must
    // be excluded from the catalogue fetch (findByIds would return
    // nothing and then throw "Product X not found"). They pass their
    // own sku / name / unitPrice on the DTO.
    const isCustomItem = (
      it: CreateOrderDto['items'][number],
    ): boolean => !!it.isCustom || !it.productId || it.productId <= 0;
    const productIds = dto.items
      .filter((i) => !isCustomItem(i))
      .map((i) => i.productId);
    // Categories are needed for EVERY priced sale, not just trade: the
    // store-wide promotion (fans 10%) matches on them too. Loading them
    // only for trade meant retail promo sales were priced without the
    // promotion here while the till showed it, and the payment check
    // rejected the sale (Sally, 14 Oct 2026: Skyfan $296.10 vs $329).
    const products =
      productIds.length === 0
        ? []
        : !dto.trustItemUnitPrices
          ? await this.productsService.findByIdsWithCategories(productIds)
          : await this.productsService.findByIds(productIds);

    // Build cart items for validation
    const cartItems = await Promise.all(
      dto.items.map(async (item) => {
        // Custom / cut-to-length items — skip the catalogue lookup, no
        // trade auto-discount, no stock check. Everything comes from
        // the DTO. cashier's manual discount still applies.
        if (isCustomItem(item)) {
          const price = Number(item.unitPrice);
          if (!Number.isFinite(price) || price < 0) {
            throw new BadRequestException(
              `Custom item "${item.name || item.sku || ''}" needs a valid unitPrice`,
            );
          }
          if (!item.sku && !item.name) {
            throw new BadRequestException(
              'Custom item needs a sku or name',
            );
          }
          const manualDiscount = item.discountPercent || 0;
          return {
            productId: item.productId,
            sku: (item.sku || 'CUSTOM').slice(0, 100),
            name: (item.name || item.sku || 'Custom Item').slice(0, 255),
            quantity: item.quantity,
            unitPrice: price,
            discountPercent: manualDiscount,
            manualDiscountPercent: manualDiscount,
            isSaleItem: false,
            // Custom items have no catalogue cost — nothing to enforce
            // the cost+30% floor against.
            cost: null as number | null,
            promoName: null as string | null,
          };
        }
        const product = products.find((p) => p.id === item.productId);
        if (!product) {
          throw new BadRequestException(
            `Product ${item.productId} not found`,
          );
        }
        // Trade auto-discount is resolved first because the base-price
        // choice below depends on what the trade rate actually works out to.
        const manualDiscount = item.discountPercent || 0;
        const auto =
          isTradeOrder && !dto.trustItemUnitPrices
            ? await this.tradeDiscounts.getAutoDiscount(product)
            : { percent: 0, label: null, baseOnSpecialPrice: false };
        const autoDiscount = auto.percent;
        // Store-wide promotion (fans 10%, Oct 2026) — every customer. Not
        // on a line the cashier re-priced, nor on locked quote prices.
        const promo =
          !dto.trustItemUnitPrices && !item.priceEdited
            ? await this.tradeDiscounts.getPromoDiscount(product)
            : { percent: 0, label: null, name: null };

        // Base price selection:
        //   - Retail customers on a SALE item: use special price.
        //   - Trade customers: normally the fixed retail price, even when
        //     the item is on sale — the trade % applies to that base, so
        //     trade never stacks on top of the sale discount (trade off
        //     retail only). Rules flagged baseOnSpecialPrice (Ceiling
        //     Fans: "15% on Special Price") apply their % to the
        //     sale-aware price instead.
        //   - EXCEPT when that lands ABOVE what a walk-in would pay on a
        //     deep sale. Sally: "If Trade price is dearer than the
        //     customer price, an automatic rule that customer price is
        //     taken than Trade". In that case we drop to the retail/sale
        //     price and skip the trade auto-discount entirely.
        const isOnSale = product.isOnSale;
        const retailNet = isOnSale
          ? Number(product.specialPrice)
          : Number(product.price);
        const tradeBase = auto.baseOnSpecialPrice
          ? retailNet
          : Number(product.price);
        const tradeNet = tradeBase * (1 - autoDiscount / 100);
        const tradeWins = !isTradeOrder || tradeNet <= retailNet;
        const effective = isTradeOrder
          ? tradeWins
            ? tradeBase
            : retailNet
          : retailNet;
        // Honour a per-line unitPrice override when:
        //   1. the line is a backorder (catalogue may be $0 / out of date), OR
        //   2. the caller is trusted (dto.trustItemUnitPrices) — used by
        //      the quote-conversion flow so the locked-in quoted price
        //      flows through to the order. Without this, the backend
        //      rebuilds the order at current catalogue price and the
        //      payment-mismatch check rejects the conversion. OR
        //   3. the cashier explicitly re-priced the line (priceEdited) —
        //      staff may change the actual price, SALE/clearance
        //      included; the cost+30% floor below is the guard.
        // Other lines always use the catalogue price.
        const resolvedUnitPrice =
          (item.isBackorder || dto.trustItemUnitPrices || item.priceEdited) &&
          item.unitPrice != null &&
          Number(item.unitPrice) >= 0
            ? Number(item.unitPrice)
            : parseFloat(effective.toString());
        // Trade auto-discount acts as a floor: the cashier's manual
        // discount only takes effect if it's higher. Zeroed when the
        // sale price already beat the trade rate (see tradeWins above) —
        // the base is the sale price there, so re-applying trade % on
        // top would double-discount. A cashier-re-priced line is charged
        // exactly the typed price, trade or not — no trade % or promotion
        // on top (Sally, 12 Oct 2026: typed $170 on a trade line came out
        // at $136). The cost + margin floor below still guards it.
        // A trade customer gets whichever is better: trade rate or promotion.
        const appliedAutoDiscount = item.priceEdited
          ? 0
          : Math.max(tradeWins ? autoDiscount : 0, promo.percent);
        const effectiveDiscount = Math.max(manualDiscount, appliedAutoDiscount);
        // The promotion gave this line its discount (it wins or ties), so
        // the invoice names it (Sally, 1 Nov 2026: Black Friday).
        const promoName =
          !item.priceEdited && promo.percent > 0 && promo.percent >= effectiveDiscount - 1e-9
            ? promo.name
            : null;
        return {
          productId: item.productId,
          sku: product.sku,
          name: product.name,
          quantity: item.quantity,
          unitPrice: resolvedUnitPrice,
          discountPercent: effectiveDiscount,
          // Track the manual portion separately so the discounts service
          // only validates the cashier's piece against their role limit.
          // Auto trade is company policy and bypasses role caps.
          manualDiscountPercent: manualDiscount,
          // Clearance items are excluded from the cart-level discount.
          isSaleItem: product.isOnSale,
          cost: product.cost != null ? Number(product.cost) : null,
          promoName,
          // Set trade price for this product, when selling to trade —
          // exempts the line from the margin floor at that price.
          approvedPrice:
            isTradeOrder && product.tradePrice != null
              ? Number(product.tradePrice)
              : null,
        };
      }),
    );

    // Minimum-margin guard: the price the customer actually pays per unit
    // (list price net of the effective discount) can't undercut cost+30%.
    // Managers/admins may override; sales_staff cannot. Checked against
    // the final per-unit sell price, not the pre-discount unitPrice.
    const minMarginMultiplier = await this.tradeDiscounts.getMinMarginMultiplier();
    const costFloorErrors = this.discountsService.checkCostFloor(
      cartItems.map((c) => ({
        sku: c.sku,
        name: c.name,
        unitPrice: c.unitPrice * (1 - c.discountPercent / 100),
        cost: c.cost,
        approvedPrice: (c as { approvedPrice?: number | null }).approvedPrice ?? null,
      })),
      userRole,
      minMarginMultiplier,
    );
    if (costFloorErrors.length > 0) {
      // Name the lines (Sally, 8 Oct 2026: the generic message left staff
      // guessing which item was the problem). Names only — never the
      // cost or the floor, which sales staff mustn't see.
      const offenders = costFloorErrors.map((e) => {
        const sku = String(e.field || '').replace(/^items\./, '').replace(/\.unitPrice$/, '');
        const line = cartItems.find((c) => c.sku === sku);
        return line ? `${line.name} (${line.sku})` : sku;
      });
      throw new BadRequestException({
        code: 'BELOW_COST_FLOOR',
        message:
          `${offenders.length === 1 ? 'This item is' : 'These items are'} priced below the ` +
          `minimum allowed margin — ask a manager or admin to put the sale through: ` +
          offenders.join(', '),
        errors: costFloorErrors,
      });
    }

    // Validate discounts. Trade auto-discount is company policy (not a
    // discretionary cashier override) so it bypasses the role-cap
    // check — we validate using only the manual portion, then run
    // calculateCartTotals with the effective discount so the totals
    // include the trade rate.
    const validationItems = cartItems.map((c) => ({
      ...c,
      discountPercent: c.manualDiscountPercent,
    }));
    const validation = this.discountsService.validateAndCalculate(
      { items: validationItems, cartDiscount: dto.cartDiscount },
      userRole,
    );

    if (!validation.isValid) {
      throw new BadRequestException({
        code: 'DISCOUNT_VALIDATION_FAILED',
        message: 'Discount validation failed',
        errors: validation.errors,
      });
    }

    // Recompute totals with the effective (manual ⨆ auto) discount so
    // the trade auto rate flows into payment-amount checks downstream.
    validation.calculatedTotals = this.discountsService.calculateCartTotals(
      cartItems,
      dto.cartDiscount,
      false,
    );

    // Check stock. Skip backorder lines — those are explicitly allowed
    // to exceed available stock and stock isn't deducted until fulfilment.
    // For partial backorders ("ordered 4, take 2, backorder 2") only the
    // take-now portion needs to be in stock right now.
    const supplierByProductId = new Map<number, string>();
    for (const item of dto.items) {
      const sup = String(item.supplier || '').trim().slice(0, 120);
      if (sup) supplierByProductId.set(item.productId, sup);
    }
    const isBackorderByProductId = new Map<number, boolean>();
    const isLaybyHeldByProductId = new Map<number, boolean>();
    const backorderQtyByProductId = new Map<number, number>();
    const laybyHeldQtyByProductId = new Map<number, number>();
    for (const item of dto.items) {
      isBackorderByProductId.set(item.productId, !!item.isBackorder);
      isLaybyHeldByProductId.set(item.productId, !!item.isLaybyHeld);
      if (item.isLaybyHeld) {
        const split = Math.min(
          Number(item.quantity) || 0,
          Math.max(
            0,
            item.laybyHeldQty != null
              ? Number(item.laybyHeldQty)
              : Number(item.quantity) || 0,
          ),
        );
        laybyHeldQtyByProductId.set(item.productId, split);
      }
      if (item.isBackorder) {
        // Default split = the entire line is backordered. Clamp to the
        // line quantity so a misuse can't create negative take-now.
        const split = Math.min(
          Number(item.quantity) || 0,
          Math.max(
            0,
            item.backorderQty != null
              ? Number(item.backorderQty)
              : Number(item.quantity) || 0,
          ),
        );
        backorderQtyByProductId.set(item.productId, split);
        const takeNowQty = (Number(item.quantity) || 0) - split;
        if (takeNowQty <= 0) continue; // entire line is backorder, skip stock check
        const product = products.find((p) => p.id === item.productId);
        if (product && product.manageStock && product.stockQty < takeNowQty) {
          throw new BadRequestException(
            `Insufficient stock for ${product.name} (take-now portion). Available: ${product.stockQty}, requested: ${takeNowQty}.`,
          );
        }
        continue;
      }
      const product = products.find((p) => p.id === item.productId);
      if (product && product.manageStock && product.stockQty < item.quantity) {
        throw new BadRequestException(
          `Insufficient stock for ${product.name}. Available: ${product.stockQty}. ` +
          `(isBackorder flag received from client: ${JSON.stringify(item.isBackorder)})`,
        );
      }
    }

    // Figure out what kind of order this is and how much the customer must
    // actually pay now. Any line flagged isLaybyHeld turns the whole
    // order into a layby; any backorder line flags the order as
    // backorder-pending; both can coexist on the same order.
    const hasBackorder = Array.from(isBackorderByProductId.values()).some(
      (b) => b,
    );
    const hasLaybyHeld = Array.from(isLaybyHeldByProductId.values()).some(
      (b) => b,
    );
    const isLayby = dto.orderType === 'layby' || hasLaybyHeld;

    // Pickup vs delivery — the server picks the fee from DELIVERY_FEES
    // for whatever method the client sent, so the cashier's UI total
    // can't drift from what we actually charge. Fees are GST-inclusive
    // (matches the rest of the AU pricing convention).
    const validDeliveryTypes = new Set<DeliveryType>([
      DeliveryType.PICKUP,
      DeliveryType.DELIVERY,
      DeliveryType.LOCAL_METRO,
      DeliveryType.AUSTPOST,
      DeliveryType.CUSTOM,
    ]);
    const deliveryType: DeliveryType = validDeliveryTypes.has(
      dto.deliveryType as DeliveryType,
    )
      ? (dto.deliveryType as DeliveryType)
      : DeliveryType.PICKUP;
    let deliveryFee = DELIVERY_FEES[deliveryType] || 0;
    if (deliveryType === DeliveryType.CUSTOM) {
      // Custom = whatever the cashier typed (Sally, 16 Sep 2026). Still
      // validated: a number, not negative, cents-rounded.
      const raw = Number(dto.deliveryFee);
      if (!Number.isFinite(raw) || raw < 0) {
        throw new BadRequestException(
          'Custom delivery needs a delivery fee amount of $0.00 or more',
        );
      }
      deliveryFee = Math.round(raw * 100) / 100;
    }
    const grandTotal =
      Math.round((validation.calculatedTotals.grandTotal + deliveryFee) * 100) /
      100;

    // One-line breadcrumb so we can see in pm2 logs whether the layby flag
    // and backorder flags actually reached the server. Cheap and helpful
    // next time someone reports "it didn't work".
    // eslint-disable-next-line no-console
    console.log(
      `[orders.create] type=${dto.orderType || 'standard'} isLayby=${isLayby} hasBackorder=${hasBackorder} grandTotal=${grandTotal} payments=${dto.payments.length}`,
    );

    // Laybys require a linked customer — without one, there's no way to
    // track the balance or release credits on cancellation.
    if (isLayby && !dto.customerId) {
      throw new BadRequestException(
        'Layby orders must be linked to a customer',
      );
    }

    // Verify payment amount. Standard orders must pay the full grand
    // total; laybys must pay at least the configured deposit percent
    // (default 20%). Coerce amounts to Number so a stray string
    // amount doesn't silently concatenate into a bogus total.
    // Reject any negative payment line — a negative amount must never be
    // accepted (it would credit the till / understate the sale).
    if (dto.payments.some((p) => Number(p.amount) < 0)) {
      throw new BadRequestException('Payment amounts cannot be negative');
    }

    // A real sale must have a positive total — guards against a discount
    // that zeroed (or inverted) the order.
    if (grandTotal <= 0) {
      throw new BadRequestException(
        'Order total must be greater than $0 (check the discount applied)',
      );
    }

    const totalPayments = dto.payments.reduce(
      (sum, p) => sum + Number(p.amount || 0),
      0,
    );

    // Deposit-based orders: laybys OR any order with backorder items let
    // the customer pay a deposit now (>= 20% of the deferred portion)
    // with balance collected later. Take-now lines must be paid in
    // full at the register; held / backorder lines only need their 20%
    // share now.
    const isDepositOrder = isLayby || hasBackorder;
    if (isDepositOrder) {
      // Resolve the min deposit percent from settings (same 20% default
      // for both layby and backorder).
      const minPercent = Number(
        (await this.settingsService.getValue<number | string>(
          isLayby ? 'layby_min_deposit_percent' : 'backorder_min_deposit_percent',
          20,
        )) || 20,
      );

      // Split the cart into take-now and deferred portions, honouring
      // the per-line backorder qty split. Customer must pay full price
      // for take-now items (they're walking out with them) plus 20% of
      // the deferred items (lay-by held + remaining-on-backorder).
      // A line may carry BOTH flags (Sally, 9 Sep: "Back order 3 and
      // Layby the 2") — the backorder split is applied first and the
      // held split is clamped to whatever quantity remains.
      let takeNowSubtotal = 0;
      let deferredSubtotal = 0;
      for (const calc of validation.calculatedTotals.items) {
        const isBack = !!isBackorderByProductId.get(calc.productId);
        const isHeld = !!isLaybyHeldByProductId.get(calc.productId);
        const qty = Number(calc.quantity) || 0;
        const rowTotal = Number(calc.rowTotal) || 0;
        const rawBack = backorderQtyByProductId.get(calc.productId);
        const backQty = isBack
          ? Math.min(qty, Math.max(0, rawBack != null ? Number(rawBack) : qty))
          : 0;
        const rawHeld = laybyHeldQtyByProductId.get(calc.productId);
        const heldQty = isHeld
          ? Math.min(
              qty - backQty,
              Math.max(0, rawHeld != null ? Number(rawHeld) : qty),
            )
          : 0;
        const perUnit = qty > 0 ? rowTotal / qty : 0;
        deferredSubtotal += perUnit * (backQty + heldQty);
        takeNowSubtotal += perUnit * (qty - backQty - heldQty);
      }
      takeNowSubtotal = Math.round(takeNowSubtotal * 100) / 100;
      deferredSubtotal = Math.round(deferredSubtotal * 100) / 100;
      const minDeposit =
        Math.round(
          (takeNowSubtotal + (deferredSubtotal * minPercent) / 100) * 100,
        ) / 100;

      const depositOverridden = !!userRole && [
        'admin',
        'manager',
      ].includes(userRole.name);
      const label = hasLaybyHeld
        ? 'Mixed Lay By'
        : isLayby
          ? 'Layby'
          : 'Backorder';
      // Any user may take NO deposit — the whole balance is owed on
      // collection (Sally, 15 Oct 2026: regular and trade customers who
      // won't pay up front). A part payment under the minimum still needs
      // a manager or admin.
      const noDeposit = totalPayments <= 0.005;
      if (!noDeposit && totalPayments + 0.01 < minDeposit && !depositOverridden) {
        throw new BadRequestException(
          `${label} deposit of $${totalPayments.toFixed(2)} is below the minimum: ` +
          `take-now $${takeNowSubtotal.toFixed(2)} (paid in full) + ` +
          `${minPercent}% of deferred $${deferredSubtotal.toFixed(2)} = $${minDeposit.toFixed(2)}. ` +
          `A manager can override.`,
        );
      }
      if (totalPayments > grandTotal + 0.01) {
        throw new BadRequestException(
          `${label} deposit $${totalPayments.toFixed(2)} exceeds the order total $${grandTotal.toFixed(2)}`,
        );
      }
    } else if (Math.abs(totalPayments - grandTotal) > 0.01) {
      const breakdown = dto.payments
        .map((p) => `${p.method}:$${Number(p.amount || 0).toFixed(2)}`)
        .join(', ');
      throw new BadRequestException(
        `Payment amount $${totalPayments.toFixed(2)} does not match order total $${grandTotal.toFixed(2)} (${breakdown})`,
      );
    }

    // Store credit validation: if any payment uses store_credit, the order
    // must be linked to a customer and that customer must have enough balance.
    const storeCreditTotal = dto.payments
      .filter((p) => p.method === 'store_credit')
      .reduce((sum, p) => sum + Number(p.amount), 0);
    if (storeCreditTotal > 0) {
      if (!dto.customerId) {
        throw new BadRequestException(
          'Store credit can only be used when a customer is attached to the order',
        );
      }
      await this.storeCreditService.assertSufficientBalance(
        dto.customerId,
        storeCreditTotal,
      );
    }

    // Generate order number
    const orderNumber = await this.generateOrderNumber();

    // Pick the right status/payment-status combo for this order.
    // Laybys sit in LAYBY_ACTIVE until fully paid.
    // Orders containing backorder items sit in BACKORDER_PENDING until every
    // line is fulfilled.
    // Everything else completes immediately.
    let initialStatus: OrderStatus;
    if (isLayby) {
      initialStatus = OrderStatus.LAYBY_ACTIVE;
    } else if (hasBackorder) {
      initialStatus = OrderStatus.BACKORDER_PENDING;
    } else {
      initialStatus = OrderStatus.COMPLETE;
    }
    // Deposit orders (layby OR backorder with deposit-only) sit in
    // PARTIAL until the balance is paid. A backorder order that was
    // paid in full can still go straight to PAID.
    let initialPaymentStatus: PaymentStatus;
    if (isDepositOrder && totalPayments + 0.01 < grandTotal) {
      initialPaymentStatus =
        totalPayments > 0 ? PaymentStatus.PARTIAL : PaymentStatus.PENDING;
    } else {
      initialPaymentStatus = PaymentStatus.PAID;
    }

    // Compute layby expiry from settings unless the caller supplied one.
    let laybyExpiresAt: Date | null = null;
    if (isLayby) {
      if (dto.laybyExpiresAt) {
        laybyExpiresAt = new Date(dto.laybyExpiresAt);
      } else {
        const maxDays = Number(
          (await this.settingsService.getValue<number | string>(
            'layby_max_days',
            90,
          )) || 90,
        );
        laybyExpiresAt = new Date(Date.now() + maxDays * 24 * 60 * 60 * 1000);
      }
    }

    // Create order in transaction
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    // Discount audit-log writes collected during the transaction and
    // flushed AFTER commit. They run on a different pooled connection,
    // so writing them mid-transaction self-deadlocks against our own
    // uncommitted order rows (50s lock-wait timeout, failed sale).
    const deferredDiscountAudits: Array<() => Promise<unknown>> = [];

    try {
      // Create order
      const order = queryRunner.manager.create(Order, {
        orderNumber,
        customerId: dto.customerId || null,
        isTrade: isTradeOrder,
        userId,
        subtotal: validation.calculatedTotals.subtotal,
        discountAmount: validation.calculatedTotals.totalDiscount,
        taxAmount: validation.calculatedTotals.taxAmount,
        grandTotal,
        taxRate: this.taxRate,
        status: initialStatus,
        paymentStatus: initialPaymentStatus,
        syncStatus: OrderSyncStatus.PENDING,
        notes: dto.notes || null,
        internalNotes: dto.internalNotes || null,
        // Walk-in orders can still carry a customer name (e.g. "John"
        // typed by the cashier) even without a Customer FK. When
        // customerId is set the linked row is authoritative, so we
        // only snapshot when no customerId was provided.
        customerNameSnapshot:
          !dto.customerId && dto.customerName
            ? String(dto.customerName).trim().slice(0, 200) || null
            : null,
        orderType: isLayby ? OrderType.LAYBY : OrderType.STANDARD,
        laybyExpiresAt,
        deliveryType,
        deliveryFee,
        deliveryRegion:
          dto.deliveryRegion === 'local' || dto.deliveryRegion === 'interstate'
            ? dto.deliveryRegion
            : null,
        exchangeFromOrderId: dto.exchangeFromOrderId ?? null,
      });

      const savedOrder = await queryRunner.manager.save(order);

      // Create order items. A partial backorder ("4 ordered, 2 taken
      // home, 2 ordered from supplier") is split here into TWO order_item
      // rows so refunds, fulfilment, and reporting can all treat the
      // halves independently. Quantities + line totals are pro-rated.
      for (const calcItem of validation.calculatedTotals.items) {
        const product = products.find((p) => p.id === calcItem.productId);
        const lineIsBackorder = !!isBackorderByProductId.get(calcItem.productId);
        const lineIsLaybyHeld = !!isLaybyHeldByProductId.get(calcItem.productId);
        const totalQty = Number(calcItem.quantity);
        const backQtyRaw = backorderQtyByProductId.get(calcItem.productId);
        const heldQtyRaw = laybyHeldQtyByProductId.get(calcItem.productId);
        const backQty = lineIsBackorder
          ? backQtyRaw == null
            ? totalQty
            : Math.min(totalQty, Math.max(0, backQtyRaw))
          : 0;
        const heldQty = lineIsLaybyHeld
          ? heldQtyRaw == null
            ? totalQty
            : Math.min(totalQty, Math.max(0, heldQtyRaw))
          : 0;
        const perUnit =
          totalQty > 0 ? calcItem.rowTotal / totalQty : calcItem.unitPrice;

        // Helper to actually create + save an order_item row + log
        // discount + decrement stock (when applicable).
        const createRow = async (
          qty: number,
          flagBackorder: boolean,
          flagHeld: boolean,
        ): Promise<OrderItem | null> => {
          if (qty <= 0) return null;
          const rowTotal = Math.round(perUnit * qty * 100) / 100;
          const lineDiscountAmount = Math.round(
            (Number(calcItem.discountAmount) / Math.max(1, totalQty)) * qty * 100,
          ) / 100;
          const lineTaxAmount = Math.round(
            (Number(calcItem.taxAmount) / Math.max(1, totalQty)) * qty * 100,
          ) / 100;
          // Persist productId as NULL for custom items so we don't
          // dangle an FK to a non-existent product row.
          const persistedProductId =
            calcItem.productId && calcItem.productId > 0
              ? calcItem.productId
              : null;
          const orderItem = queryRunner.manager.create(OrderItem, {
            orderId: savedOrder.id,
            productId: persistedProductId,
            sku: product?.sku || calcItem.sku,
            name: product?.name || calcItem.name,
            quantity: qty,
            unitPrice: calcItem.unitPrice,
            discountPercent: calcItem.discountPercent,
            discountAmount: lineDiscountAmount,
            taxAmount: lineTaxAmount,
            rowTotal,
            costPrice: product?.cost || null,
            promoLabel:
              cartItems.find((c) => c.productId === calcItem.productId && calcItem.productId > 0)?.promoName ?? null,
            isBackorder: flagBackorder,
            isLaybyHeld: flagHeld && !flagBackorder,
            supplier: supplierByProductId.get(calcItem.productId) ?? null,
          });
          await queryRunner.manager.save(orderItem);

          if (calcItem.discountPercent > 0) {
            // DEFERRED until after commit. The audit repository uses a
            // different pooled connection, and its FK check against the
            // just-inserted (uncommitted) order/order_item rows blocks on
            // locks this transaction holds — while this transaction waits
            // on the insert. Self-deadlock, 50s lock-wait timeout, dead
            // sale. Discounted orders were failing with a 500 because of
            // exactly this.
            const itemId = orderItem.id;
            const discountPct = calcItem.discountPercent;
            const unitPriceForAudit = calcItem.unitPrice;
            deferredDiscountAudits.push(() =>
              this.discountsService.logAppliedDiscount(
                savedOrder.id,
                itemId,
                userId,
                userRole.name,
                DiscountType.PRODUCT,
                discountPct,
                lineDiscountAmount,
                unitPriceForAudit * qty,
                rowTotal,
                dto.cartDiscount ? true : false,
              ),
            );
          }

          // Decrement stock for everything except the backorder portion
          // (those items aren't on the shelf yet — stock comes off when
          // the manager fulfills). Lay-by held items DO take stock —
          // they're physically reserved on the shelf.
          if (product && !flagBackorder) {
            await queryRunner.manager.update(
              'products',
              { id: product.id },
              {
                stockQty: () => `stock_qty - ${qty}`,
                isInStock: () =>
                  `CASE WHEN stock_qty - ${qty} > 0 THEN 1 ELSE 0 END`,
              },
            );
          }
          return orderItem;
        };

        // Generic three-way split: a line can be part take-now, part
        // backorder AND part lay-by held (Sally, 9 Sep: "Back order 3
        // and Layby the 2"). The backorder split is applied first; the
        // held split is clamped to what's left. createRow no-ops on
        // qty <= 0, so pure/no-flag lines still produce a single row.
        const heldQtyClamped = Math.min(heldQty, totalQty - backQty);
        await createRow(totalQty - backQty - heldQtyClamped, false, false);
        await createRow(backQty, true, false);
        await createRow(heldQtyClamped, false, true);
      }

      // Log cart discount if applied — deferred until after commit for
      // the same self-deadlock reason as the per-item audits above.
      if (dto.cartDiscount && dto.cartDiscount.value > 0) {
        deferredDiscountAudits.push(() =>
          this.discountsService.logAppliedDiscount(
            savedOrder.id,
            null,
            userId,
            userRole.name,
            DiscountType.CART,
            dto.cartDiscount!.type === 'percent' ? dto.cartDiscount!.value : 0,
            validation.calculatedTotals.cartDiscount,
            validation.calculatedTotals.subtotal -
              validation.calculatedTotals.itemDiscounts,
            validation.calculatedTotals.grandTotal,
            validation.calculatedTotals.itemDiscounts > 0,
            dto.cartDiscount!.reason,
          ),
        );
      }

      // Save payments
      for (const paymentData of dto.payments) {
        const methodMap: Record<string, PaymentMethod> = {
          cash: PaymentMethod.CASH,
          eftpos: PaymentMethod.EFTPOS,
          credit_card: PaymentMethod.CREDIT_CARD,
          bank_transfer: PaymentMethod.BANK_TRANSFER,
          store_credit: PaymentMethod.STORE_CREDIT,
          other: PaymentMethod.OTHER,
        };

        const payment = queryRunner.manager.create(Payment, {
          orderId: savedOrder.id,
          userId,
          method: methodMap[paymentData.method] || PaymentMethod.OTHER,
          amount: paymentData.amount,
          reference: paymentData.reference || null,
          amountTendered: paymentData.amountTendered || null,
          changeGiven: paymentData.amountTendered
            ? paymentData.amountTendered - paymentData.amount
            : null,
          status: PaymentEntityStatus.COMPLETED,
        });
        await queryRunner.manager.save(payment);
      }

      // Deduct store credit after payments are recorded. Runs inside the
      // same transaction so a failure rolls back the whole order.
      if (storeCreditTotal > 0 && dto.customerId) {
        await this.storeCreditService.redeemForOrder(
          queryRunner.manager,
          dto.customerId,
          storeCreditTotal,
          savedOrder.id,
          userId,
        );
      }

      await queryRunner.commitTransaction();

      // Now the order rows are committed, write the discount audit logs.
      // Best-effort: an audit failure must never undo a completed sale.
      for (const writeAudit of deferredDiscountAudits) {
        try {
          await writeAudit();
        } catch (auditErr) {
          // eslint-disable-next-line no-console
          console.error(
            `[orders.create] discount audit write failed for order ${savedOrder.id}:`,
            auditErr,
          );
        }
      }

      // Fire-and-forget push to Magento. Runs in the background so staff
      // aren't blocked by Magento response time. Failures update the
      // order's sync_status and can be retried from the Orders page.
      //
      // Laybys don't push until they're fully paid (handled in
      // completeLayby). Backorder orders DO push — Magento tracks them as
      // a regular order with a note that items are on backorder.
      if (!isLayby) {
        this.syncService
          .pushOrderToMagentoWithRetry(savedOrder.id)
          .catch((err) => {
            // eslint-disable-next-line no-console
            console.error(
              `[pushOrderToMagento] unhandled error for order ${savedOrder.id}:`,
              err,
            );
          });
      }

      return this.findById(savedOrder.id) as Promise<Order>;
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  async findAll(options?: {
    status?: OrderStatus;
    source?: OrderSource;
    orderType?: OrderType;
    search?: string;
    userId?: number;
    customerId?: number;
    dateFrom?: Date;
    dateTo?: Date;
    page?: number;
    limit?: number;
  }): Promise<{ orders: Order[]; total: number }> {
    const {
      status,
      source,
      orderType,
      search,
      userId,
      customerId,
      dateFrom,
      dateTo,
      page = 1,
      limit = 20,
    } = options || {};

    const query = this.orderRepository
      .createQueryBuilder('order')
      .leftJoinAndSelect('order.customer', 'customer')
      .leftJoinAndSelect('order.user', 'user')
      .leftJoinAndSelect('order.items', 'items');

    if (search) {
      const text = search.trim();
      const tokens = text.split(/\s+/).filter(Boolean).slice(0, 6);
      // Phone numbers are stored as digits; "0401 792 240" should match.
      const digits = text.replace(/[\s()-]/g, '');
      // The name to match: the saved customer (first, last, business) or
      // the name kept on the order — website buyers and walk-ins typed at
      // the till (Sally, 19 Oct 2026: "Christine Rudolph" wasn't found).
      const nameExpr =
        "CONCAT_WS(' ', customer.firstName, customer.lastName, customer.company, order.customerNameSnapshot)";
      if (tokens.length > 0) {
        query.andWhere(
          new Brackets((qb: WhereExpressionBuilder) => {
            // Full-string match against order number and simple fields
            qb.where('order.orderNumber LIKE :fullSearch', { fullSearch: `%${text}%` })
              .orWhere('order.magentoIncrementId LIKE :fullSearch', { fullSearch: `%${text}%` })
              .orWhere('customer.email LIKE :fullSearch', { fullSearch: `%${text}%` })
              // Website orders keep the buyer's email and phone in the
              // import note.
              .orWhere("(order.source = 'magento' AND order.internalNotes LIKE :fullSearch)", {
                fullSearch: `%${text}%`,
              });
            if (/^\+?\d{3,}$/.test(digits)) {
              qb.orWhere('customer.phone LIKE :digits', { digits: `%${digits}%` })
                .orWhere('customer.mobile LIKE :digits', { digits: `%${digits}%` })
                .orWhere("(order.source = 'magento' AND REPLACE(order.internalNotes, ' ', '') LIKE :digits)", {
                  digits: `%${digits}%`,
                });
            }
            // Every word must be in the name, so "Christine Rudolph" finds
            // her and not everyone called Christine.
            qb.orWhere(
              new Brackets((nb: WhereExpressionBuilder) => {
                tokens.forEach((token, idx) => {
                  const key = `token${idx}`;
                  if (idx === 0) nb.where(`${nameExpr} LIKE :${key}`, { [key]: `%${token}%` });
                  else nb.andWhere(`${nameExpr} LIKE :${key}`, { [key]: `%${token}%` });
                });
              }),
            );
          }),
        );
      }
    }

    if (status) {
      query.andWhere('order.status = :status', { status });
    }

    if (source) {
      query.andWhere('order.source = :source', { source });
    }

    if (orderType) {
      query.andWhere('order.orderType = :orderType', { orderType });
    }

    if (userId) {
      query.andWhere('order.userId = :userId', { userId });
    }

    if (customerId) {
      query.andWhere('order.customerId = :customerId', { customerId });
    }

    if (dateFrom) {
      query.andWhere('order.createdAt >= :dateFrom', { dateFrom });
    }

    if (dateTo) {
      query.andWhere('order.createdAt <= :dateTo', { dateTo });
    }

    const [orders, total] = await query
      .skip((page - 1) * limit)
      .take(limit)
      .orderBy('order.createdAt', 'DESC')
      .getManyAndCount();

    return { orders, total };
  }

  async findById(id: number): Promise<Order | null> {
    return this.orderRepository.findOne({
      where: { id },
      relations: ['customer', 'user', 'items', 'payments'],
    });
  }

  // Batch lookup: given a set of order ids, return the subset that
  // have at least one exchange-replacement order pointing back at them
  // (i.e. these are originals that got exchanged). Used by the orders
  // list to swap the REFUNDED badge for EXCHANGED without an N+1.
  async findExchangedOriginals(orderIds: number[]): Promise<number[]> {
    if (!orderIds.length) return [];
    const rows = await this.orderRepository
      .createQueryBuilder('o')
      .select('DISTINCT o.exchangeFromOrderId', 'id')
      .where('o.exchangeFromOrderId IN (:...ids)', { ids: orderIds })
      .getRawMany();
    return rows
      .map((r) => Number(r.id))
      .filter((id) => Number.isFinite(id));
  }

  // Exchange cross-links for an order: the original it was exchanged
  // FROM (if this is a replacement), and any replacement orders created
  // FROM it (if this is the original that was returned). Each link
  // includes the items array so the UI can show WHAT was swapped for
  // what, not just the order numbers.
  async getExchangeLinks(order: Order): Promise<{
    exchangeFromOrder: {
      id: number;
      orderNumber: string;
      items: Array<{ id: number; sku: string; name: string; quantity: number; unitPrice: number }>;
    } | null;
    exchangedToOrders: Array<{
      id: number;
      orderNumber: string;
      items: Array<{ id: number; sku: string; name: string; quantity: number; unitPrice: number }>;
    }>;
  }> {
    const toItemSummary = (o: Order) =>
      (o.items || []).map((i) => ({
        id: i.id,
        sku: i.sku,
        name: i.name,
        quantity: i.quantity,
        unitPrice: Number(i.unitPrice),
      }));

    let exchangeFromOrder: {
      id: number;
      orderNumber: string;
      items: ReturnType<typeof toItemSummary>;
    } | null = null;
    if (order.exchangeFromOrderId) {
      const from = await this.orderRepository.findOne({
        where: { id: order.exchangeFromOrderId },
        relations: ['items'],
      });
      if (from) {
        exchangeFromOrder = {
          id: from.id,
          orderNumber: from.orderNumber,
          items: toItemSummary(from),
        };
      }
    }
    const to = await this.orderRepository.find({
      where: { exchangeFromOrderId: order.id },
      relations: ['items'],
      order: { id: 'ASC' },
    });
    return {
      exchangeFromOrder,
      exchangedToOrders: to.map((o) => ({
        id: o.id,
        orderNumber: o.orderNumber,
        items: toItemSummary(o),
      })),
    };
  }

  private async generateOrderNumber(): Promise<string> {
    // Short, readable invoice number — POS-NNNN. Drops the year and
    // padding from 6 digits to 4 to keep printed invoices compact.
    // Sequence comes from the highest existing POS-* number so we
    // don't collide with existing orders that used the longer format.
    const prefix = 'POS-';

    const lastOrder = await this.orderRepository
      .createQueryBuilder('order')
      .where('order.orderNumber LIKE :prefix', { prefix: `${prefix}%` })
      .orderBy('order.id', 'DESC')
      .getOne();

    let sequence = 1;
    if (lastOrder) {
      // Pull the trailing run of digits — works for both the new
      // POS-0007 format and the legacy POS-2026-000007 format.
      const match = lastOrder.orderNumber.match(/(\d+)$/);
      if (match) sequence = parseInt(match[1], 10) + 1;
    }

    return `${prefix}${sequence.toString().padStart(4, '0')}`;
  }

  /**
   * Link a customer to an existing order. Used to attach a buyer to a
   * walk-in order so staff can issue store credit on a refund.
   */
  // Website (Magento) orders are view-only in the POS (Sally, 16 Oct 2026:
  // "Website sales can only be viewed and make no changes to invoice").
  // Every endpoint that changes an order calls this first.
  async assertEditable(orderId: number): Promise<void> {
    const order = await this.orderRepository.findOne({
      where: { id: orderId },
      select: { id: true, source: true, voidedAt: true },
    });
    if (order?.source === OrderSource.MAGENTO) {
      throw new BadRequestException(
        'Website orders are view-only in the POS — make any changes in Magento',
      );
    }
    if (order?.voidedAt) {
      throw new BadRequestException('This sale was voided — it can no longer be changed');
    }
  }

  // Void a sale put through by mistake, e.g. twice (Sally, 17 Oct 2026:
  // "a void button where we can just clear any duplicates ... so that way
  // it's not added on to the sales reports or back orders"). Admin only.
  // The order is cancelled (every report and the Backorders list already
  // leave cancelled orders out, and End of Day leaves out its payments),
  // the stock it took goes back on the shelf, and who / why is kept on
  // the order and in its history. Money is NOT moved: if the customer was
  // charged, reverse it on the EFTPOS terminal / give the cash back.
  async voidOrder(orderId: number, reason: string, userId: number): Promise<Order> {
    const why = (reason || '').trim();
    if (why.length < 3) throw new BadRequestException('Say why the sale is being voided');
    return this.dataSource.transaction(async (manager) => {
      const order = await manager.findOne(Order, {
        where: { id: orderId },
        relations: ['items', 'payments'],
        lock: { mode: 'pessimistic_write' },
      });
      if (!order) throw new BadRequestException('Order not found');
      if (order.voidedAt) throw new BadRequestException('This sale is already voided');
      if (order.source !== OrderSource.POS) {
        throw new BadRequestException('Only POS sales can be voided');
      }
      if (order.status === OrderStatus.CANCELLED) {
        throw new BadRequestException('This order is already cancelled');
      }
      const refunds = await manager.query(`SELECT COUNT(*) n FROM refunds WHERE order_id = ?`, [orderId]);
      if (Number(refunds?.[0]?.n) > 0) {
        throw new BadRequestException('This sale has a refund on it — it can\'t be voided');
      }
      if (order.exchangeFromOrderId) {
        throw new BadRequestException('This sale is part of an exchange — it can\'t be voided');
      }
      const exchanged = await manager.count(Order, { where: { exchangeFromOrderId: orderId } });
      if (exchanged > 0) {
        throw new BadRequestException('Goods from this sale were exchanged — it can\'t be voided');
      }
      if ((order.payments || []).some((p) => p.method === PaymentMethod.STORE_CREDIT)) {
        throw new BadRequestException('This sale used store credit — refund it instead so the credit goes back');
      }

      // Back on the shelf: what the sale took off. Back-order lines only
      // took stock if they were marked received.
      for (const item of order.items || []) {
        if (!item.productId) continue;
        const took = !item.isBackorder || !!item.backorderFulfilledAt;
        if (took && item.quantity > 0) {
          await manager.update(
            'products',
            { id: item.productId },
            {
              stockQty: () => `stock_qty + ${Number(item.quantity)}`,
              isInStock: () => `CASE WHEN stock_qty + ${Number(item.quantity)} > 0 THEN 1 ELSE 0 END`,
            },
          );
        }
      }

      const editor = await manager.findOne(User, {
        where: { id: userId },
        select: { id: true, firstName: true, lastName: true },
      });
      const who = editor ? [editor.firstName, editor.lastName].filter(Boolean).join(' ') : `user #${userId}`;
      const paid = (order.payments || [])
        .filter((p) => p.status === PaymentEntityStatus.COMPLETED)
        .reduce((s, p) => s + Number(p.amount || 0), 0);

      await manager.update(Order, { id: orderId }, {
        status: OrderStatus.CANCELLED,
        voidedAt: new Date(),
        voidedBy: userId,
        voidedByName: who.slice(0, 120),
        voidReason: why.slice(0, 2000),
      });
      await manager.save(
        manager.create(OrderEvent, {
          orderId,
          userId,
          type: 'voided',
          description:
            `Sale voided by ${who}: ${why}` +
            (paid > 0.005 ? ` ($${paid.toFixed(2)} had been taken — not refunded by the POS).` : '.'),
        }),
      );
      // eslint-disable-next-line no-console
      console.log(`[orders.voidOrder] order=${order.orderNumber} by userId=${userId} reason=${JSON.stringify(why)}`);
      return (await manager.findOne(Order, { where: { id: orderId } })) as Order;
    });
  }

  // Website orders stay view-only, except that purchasing can put a line
  // (or some of it) on back order and later mark it complete, so it shows
  // on Reports > Backorders next to POS lines and goes on the same PO
  // (Sally, 16 Oct 2026). Nothing here touches stock, money or the
  // order's status — Magento owns those.
  async setWebsiteLineStatus(
    orderId: number,
    itemId: number,
    status: 'backorder' | 'complete',
    qty: number | undefined,
    userId: number,
  ): Promise<Order> {
    const order = await this.orderRepository.findOne({ where: { id: orderId } });
    if (!order) throw new BadRequestException('Order not found');
    if (order.source !== OrderSource.MAGENTO) {
      throw new BadRequestException('Only for website orders — use the line status on POS orders');
    }
    if (order.status === OrderStatus.CANCELLED || order.status === OrderStatus.REFUNDED) {
      throw new BadRequestException(`This website order is ${order.status} — nothing to back order`);
    }
    const item = await this.orderItemRepository.findOne({ where: { id: itemId, orderId } });
    if (!item) throw new BadRequestException('Item not found on this order');

    const editor = await this.dataSource
      .getRepository(User)
      .findOne({ where: { id: userId }, select: { id: true, firstName: true, lastName: true } });
    const who = editor ? [editor.firstName, editor.lastName].filter(Boolean).join(' ') : `user #${userId}`;
    let description: string;

    if (status === 'backorder') {
      const n = Math.floor(Number(qty ?? item.quantity));
      if (!Number.isFinite(n) || n < 1 || n > item.quantity) {
        throw new BadRequestException(`Back order quantity must be 1 to ${item.quantity}`);
      }
      item.isBackorder = true;
      item.backorderQty = n < item.quantity ? n : null;
      item.backorderFulfilledAt = null;
      description = `${n} of ${item.quantity} × ${item.sku} put on back order by ${who}.`;
    } else {
      if (!item.isBackorder || item.backorderFulfilledAt) {
        throw new BadRequestException('This line isn\'t on back order');
      }
      item.backorderFulfilledAt = new Date();
      description = `${item.sku} back order marked complete by ${who}.`;
    }
    await this.orderItemRepository.save(item);
    await this.orderEventRepository.save(
      this.orderEventRepository.create({
        orderId,
        userId,
        type: status === 'backorder' ? 'website_backorder' : 'website_backorder_complete',
        description,
      }),
    );
    return (await this.findById(orderId)) as Order;
  }

  async linkCustomer(orderId: number, customerId: number, userId?: number): Promise<Order> {
    const order = await this.orderRepository.findOne({ where: { id: orderId } });
    if (!order) {
      throw new BadRequestException('Order not found');
    }
    const customer = await this.customerRepository.findOne({ where: { id: customerId } });
    if (!customer) {
      throw new BadRequestException('Customer not found');
    }
    const previous = order.customerId;
    order.customerId = customerId;
    await this.orderRepository.save(order);
    if (previous !== customerId) {
      const name = [customer.firstName, customer.lastName].filter(Boolean).join(' ') || `#${customerId}`;
      await this.orderEventRepository.save(
        this.orderEventRepository.create({
          orderId,
          userId: userId ?? null,
          type: 'customer_linked',
          description: `Customer ${name} linked to the order.`,
        }),
      );
    }
    return (await this.findById(orderId)) as Order;
  }

  // Free-form notes on an order — used from the order-detail drawer.
  // Two boxes (Sally, 26 Aug): `notes` is customer-facing and prints on
  // the invoice; `internalNotes` is staff-only. Passing undefined
  // leaves a field untouched; null/empty clears it.
  async updateNotes(
    orderId: number,
    notes: string | null | undefined,
    internalNotes?: string | null,
  ): Promise<Order> {
    const order = await this.orderRepository.findOne({ where: { id: orderId } });
    if (!order) throw new BadRequestException('Order not found');
    if (notes !== undefined) {
      order.notes = (notes && notes.trim()) || null;
    }
    if (internalNotes !== undefined) {
      order.internalNotes = (internalNotes && internalNotes.trim()) || null;
    }
    await this.orderRepository.save(order);
    return (await this.findById(orderId)) as Order;
  }

  /**
   * Add / remove / edit line items on an open order. Only allowed
   * while the order is still "open" (pending, backorder, or layby) —
   * once complete or cancelled/refunded the item list is frozen.
   *
   * The DTO shape is deliberately minimal: caller sends the full
   * replacement item list. Server recomputes subtotal/tax/grandTotal
   * from scratch using catalogue prices + per-line discounts (or the
   * supplied unitPrice for custom / backorder lines), then rewrites
   * order_items. Existing paid payments are preserved; the caller can
   * use adjustPayment() separately to reconcile over/under-collected.
   */
  async updateItems(
    orderId: number,
    userId: number,
    items: Array<{
      productId: number;
      quantity: number;
      discountPercent?: number;
      unitPrice?: number;
      isBackorder?: boolean;
      isLaybyHeld?: boolean;
      isCustom?: boolean;
      sku?: string;
      name?: string;
      // The line these units came from. Edit Items sends it because units
      // can move between taken, back order and lay-by.
      fromItemId?: number;
    }>,
    userRole: UserRole,
  ): Promise<Order> {
    const openStatuses = new Set<OrderStatus>([
      OrderStatus.PENDING,
      OrderStatus.PROCESSING,
      OrderStatus.BACKORDER_PENDING,
      OrderStatus.LAYBY_ACTIVE,
      OrderStatus.LAYBY_EXPIRED,
    ]);

    return this.dataSource.transaction(async (manager) => {
      const order = await manager.findOne(Order, {
        where: { id: orderId },
        relations: ['items'],
      });
      if (!order) throw new BadRequestException('Order not found');
      // A finished POS sale can still take more lights (Sally, 4 Nov 2026:
      // trade customers who walk out with stock and pay later). It stays
      // COMPLETE and owes the difference, collected with PAY.
      const completedPosSale =
        order.status === OrderStatus.COMPLETE && order.source === OrderSource.POS;
      if (!openStatuses.has(order.status) && !completedPosSale) {
        throw new BadRequestException(
          `Order is ${order.status} — item list is frozen. Only open orders can be edited.`,
        );
      }
      if (!items || items.length === 0) {
        throw new BadRequestException('Order must have at least one item');
      }
      // The lines as they were — for the history note and to carry each
      // line's PO / received / supplier / cost details over. They must not
      // stay on `order`: saving the order with them attached made TypeORM
      // detach the new lines (order_id = NULL), so every edit failed with
      // "internal error" (Sally, 22 Oct 2026, POS-0313).
      const oldItems: OrderItem[] = order.items || [];
      delete (order as Partial<Order>).items;
      if (oldItems.length) {
        const refunded = await manager.query(
          `SELECT COUNT(*) n FROM refund_items WHERE order_item_id IN (?)`,
          [oldItems.map((i) => i.id)],
        );
        if (Number(refunded?.[0]?.n) > 0) {
          throw new BadRequestException(
            'This order has a refund on it, so its items can\'t be edited — use Refund / Exchange instead',
          );
        }
      }

      // Resolve catalogue products for non-custom lines
      const catalogueIds = items
        .filter((i) => !i.isCustom && i.productId > 0)
        .map((i) => i.productId);
      const products =
        catalogueIds.length > 0
          ? await this.productsService.findByIds(catalogueIds)
          : [];

      // Reprice every line + rebuild totals. Mirrors the pricing rules
      // in create() but simpler (no trade auto-discount recompute —
      // whatever the caller sends stands).
      let subtotal = 0;
      let grossSubtotal = 0;
      let itemDiscounts = 0;
      const persistedItems: Partial<OrderItem>[] = [];
      const usedOld = new Set<number>();
      const isOpenBackorder = (l: Partial<OrderItem>) => !!l.isBackorder && !l.backorderFulfilledAt;
      for (const item of items) {
        const qty = Math.max(1, Math.floor(Number(item.quantity) || 0));
        let sku = item.sku || 'CUSTOM';
        let name = item.name || 'Custom Item';
        let unitPrice: number;
        let productId: number | null = null;
        let cost: number | null = null;
        let approvedPrice: number | null = null;
        // A line already on the order keeps the price it was sold at;
        // only a new line takes today's price (Sally, 22 Oct 2026: deleting
        // one light re-priced the others).
        let keepSoldPrice = false;

        if (item.isCustom || item.productId <= 0) {
          const p = Number(item.unitPrice);
          if (!Number.isFinite(p) || p < 0) {
            throw new BadRequestException(
              `Custom item "${name}" needs a valid unitPrice`,
            );
          }
          unitPrice = p;
        } else {
          const product = products.find((p) => p.id === item.productId);
          if (!product) {
            throw new BadRequestException(
              `Product ${item.productId} not found`,
            );
          }
          sku = product.sku;
          name = product.name;
          productId = product.id;
          cost = product.cost != null ? Number(product.cost) : null;
          approvedPrice =
            (order as { customer?: { isTrade?: boolean } | null }).customer?.isTrade &&
            product.tradePrice != null
              ? Number(product.tradePrice)
              : null;
          const base = product.isOnSale
            ? Number(product.specialPrice)
            : Number(product.price);
          // Backorder/quote-conversion allow a manual override; catalogue
          // lines must sell at the DB price.
          const typedBackorderPrice =
            item.isBackorder && item.unitPrice != null && item.unitPrice >= 0;
          unitPrice = typedBackorderPrice ? Number(item.unitPrice) : base;
          keepSoldPrice = !typedBackorderPrice;
        }

        // The line this came from keeps its price, PO, supplier and the cost
        // it was sold at: the one Edit Items names, else the same product in
        // the same state, else any line of that product. Units moved to or
        // from back order still sell at the price they were sold at (Sally,
        // 5 Nov 2026).
        const isBack = !!item.isBackorder;
        const sameProduct = (o: OrderItem) =>
          productId ? o.productId === productId : !o.productId && o.sku === sku && o.name === name;
        const prev =
          oldItems.find((o) => o.id === item.fromItemId && sameProduct(o)) ??
          oldItems.find((o) => !usedOld.has(o.id) && isOpenBackorder(o) === isBack && sameProduct(o)) ??
          oldItems.find(sameProduct) ??
          null;
        if (prev) usedOld.add(prev.id);
        if (keepSoldPrice && prev) unitPrice = Number(prev.unitPrice);

        const discountPct = Math.max(0, Math.min(100, item.discountPercent || 0));

        // A line keeping its price and discount isn't a new discount, so
        // today's cost can't stop units being moved on it.
        const priceUnchanged =
          !!prev &&
          Math.abs(Number(prev.unitPrice) - unitPrice) < 0.00005 &&
          Math.abs(Number(prev.discountPercent) - discountPct) < 0.0000005;
        const floorErrors = priceUnchanged
          ? []
          : this.discountsService.checkCostFloor(
              [
                {
                  sku,
                  name,
                  unitPrice: unitPrice * (1 - discountPct / 100),
                  cost,
                  approvedPrice,
                },
              ],
              userRole,
              await this.tradeDiscounts.getMinMarginMultiplier(),
            );
        if (floorErrors.length > 0) {
          throw new BadRequestException({
            code: 'BELOW_COST_FLOOR',
            message: floorErrors[0].message,
          });
        }

        const lineGross = unitPrice * qty;
        const lineDiscount = Math.round(lineGross * (discountPct / 100) * 100) / 100;
        const rowTotal = Math.round((lineGross - lineDiscount) * 100) / 100;
        const rowTax = Math.round((rowTotal / 11) * 100) / 100;

        subtotal += rowTotal;
        grossSubtotal += lineGross;
        itemDiscounts += lineDiscount;

        // Units newly put on back order haven't been ordered yet, so they
        // don't take a PO from the line they came off.
        const keepPo = !isBack || (!!prev && isOpenBackorder(prev));
        persistedItems.push({
          orderId: order.id,
          productId,
          sku,
          name,
          quantity: qty,
          unitPrice,
          discountPercent: discountPct,
          discountAmount: lineDiscount,
          taxAmount: rowTax,
          rowTotal,
          isBackorder: isBack,
          isLaybyHeld: !!item.isLaybyHeld && !item.isBackorder,
          costPrice: prev?.costPrice ?? (cost != null && cost > 0 ? cost : null),
          promoLabel: prev?.promoLabel ?? null,
          poNumber: keepPo ? prev?.poNumber ?? null : null,
          poSentAt: keepPo ? prev?.poSentAt ?? null : null,
          backorderFulfilledAt: null,
          backorderQty: prev && prev.backorderQty != null && prev.backorderQty < qty ? prev.backorderQty : null,
          supplier: prev?.supplier ?? null,
        });
      }

      // Moving units must not move the money, but a line rounds differently
      // once it's cut in two. Lines that kept their product, price, discount
      // and total quantity keep what they came to.
      const r2 = (n: number) => Math.round(n * 100) / 100;
      const sameSale = (l: Partial<OrderItem>) =>
        [
          l.productId ?? `${l.sku}|${l.name}`,
          Number(l.unitPrice).toFixed(4),
          Number(l.discountPercent).toFixed(6),
        ].join('|');
      const sumOf = (rows: Partial<OrderItem>[], f: (l: Partial<OrderItem>) => unknown) =>
        rows.reduce((t, l) => t + Number(f(l) || 0), 0);
      const newSales = new Set(persistedItems.map(sameSale));
      let onlyMoved = newSales.size === new Set(oldItems.map(sameSale)).size;
      for (const key of newSales) {
        const now = persistedItems.filter((l) => sameSale(l) === key);
        const was = oldItems.filter((l) => sameSale(l) === key);
        if (!was.length || sumOf(was, (l) => l.quantity) !== sumOf(now, (l) => l.quantity)) {
          onlyMoved = false;
          continue;
        }
        const drift = r2(sumOf(was, (l) => l.rowTotal) - sumOf(now, (l) => l.rowTotal));
        if (!drift) continue;
        const last = now[now.length - 1];
        const discount = Math.max(0, r2(Number(last.discountAmount) - drift));
        itemDiscounts += discount - Number(last.discountAmount);
        subtotal += drift;
        last.discountAmount = discount;
        last.rowTotal = r2(Number(last.rowTotal) + drift);
        last.taxAmount = r2(Number(last.rowTotal) / 11);
      }

      subtotal = Math.round(subtotal * 100) / 100;
      // The cart discount ("Apply Further Discount") is on the order, not
      // on any line, so rebuilding the lines must carry it over — an edit
      // dropped POS-0342's $385.20 and the reprint billed the full price
      // (Sally, 23 Oct 2026). A % discount keeps its share of the order; a
      // $ discount keeps its amount, never more than the order.
      const cart = await this.getCartDiscount(order, oldItems, manager);
      const oldBase = oldItems.reduce((t, i) => t + Number(i.rowTotal || 0), 0);
      let cartDiscount = 0;
      if (cart.amount > 0) {
        cartDiscount =
          cart.percent != null && oldBase > 0
            ? Math.round(cart.amount * (subtotal / oldBase) * 100) / 100
            : Math.min(cart.amount, subtotal);
      }
      // Stored the way create() stores it: subtotal before any discount,
      // discountAmount = line + cart discounts.
      grossSubtotal = Math.round(grossSubtotal * 100) / 100;
      const totalDiscount = Math.round((itemDiscounts + cartDiscount) * 100) / 100;
      const goods = Math.round((subtotal - cartDiscount) * 100) / 100;
      // Nothing bought or re-priced: the order's totals stand. A sale's total
      // can sit a cent off the sum of its lines, and moving units or saving
      // without a change mustn't leave a paid order owing that cent.
      const taxAmount = onlyMoved ? Number(order.taxAmount) : Math.round((goods / 11) * 100) / 100;
      const grandTotal = onlyMoved
        ? Number(order.grandTotal)
        : Math.round((goods + Number(order.deliveryFee || 0)) * 100) / 100;

      // Wipe existing rows + insert the new set. Simplest correct
      // approach — trying to diff line-by-line would be fragile given
      // partial-backorder / partial-layby splits.
      await manager.delete(OrderItem, { orderId: order.id });
      for (const row of persistedItems) {
        await manager.save(manager.create(OrderItem, row));
      }

      // Recompute payment status against the new total.
      const paid = await this.sumPaidForOrder(order.id);
      const paymentStatus =
        paid >= grandTotal - 0.01
          ? PaymentStatus.PAID
          : paid > 0
            ? PaymentStatus.PARTIAL
            : PaymentStatus.PENDING;
      await manager.update(Order, { id: order.id }, {
        subtotal: onlyMoved ? Number(order.subtotal) : grossSubtotal,
        discountAmount: onlyMoved ? Number(order.discountAmount) : totalDiscount,
        taxAmount,
        grandTotal,
        paymentStatus,
        updatedAt: new Date(),
      });

      // Units moved between taken, back order and lay-by (Sally, 5 Nov
      // 2026: one on back order turned out to be in stock).
      const splitOf = (rows: Partial<OrderItem>[]) => {
        const m = new Map<string, { name: string; productId: number | null; total: number; back: number; held: number }>();
        for (const r of rows) {
          const key = r.sku || r.name || '?';
          const cur = m.get(key) ?? { name: r.name || key, productId: r.productId ?? null, total: 0, back: 0, held: 0 };
          const q = Number(r.quantity) || 0;
          cur.total += q;
          if (isOpenBackorder(r)) cur.back += q;
          else if (r.isLaybyHeld) cur.held += q;
          m.set(key, cur);
        }
        return m;
      };
      const splitBefore = splitOf(oldItems);
      const splitAfter = splitOf(persistedItems);
      const splitChanges: string[] = [];
      for (const key of new Set([...splitBefore.keys(), ...splitAfter.keys()])) {
        const b = splitBefore.get(key);
        const a = splitAfter.get(key);
        const name = (a ?? b)?.name;
        const was = { back: b?.back ?? 0, held: b?.held ?? 0 };
        const now = { back: a?.back ?? 0, held: a?.held ?? 0 };
        if (was.back !== now.back) splitChanges.push(`${name}: back order ${was.back} → ${now.back}`);
        if (was.held !== now.held) splitChanges.push(`${name}: lay-by ${was.held} → ${now.held}`);
        // Back orders don't take stock; taken and lay-by units do, as at
        // the sale. Only when the quantity stayed the same: a changed
        // quantity has never moved stock here.
        const moved = was.back - now.back;
        if (moved !== 0 && a?.productId && b?.total === a.total) {
          await manager.update(
            'products',
            { id: a.productId },
            {
              stockQty: () => `stock_qty - (${moved})`,
              isInStock: () => `CASE WHEN stock_qty - (${moved}) > 0 THEN 1 ELSE 0 END`,
            },
          );
        }
      }
      // The order follows its lines, as with the per-line status menu. An
      // edit that moves nothing leaves the status alone, so a finished sale
      // that took more lights stays COMPLETE and owes the difference.
      let completedNow = false;
      if (splitChanges.length > 0) {
        order.grandTotal = grandTotal;
        order.paymentStatus = paymentStatus;
        completedNow = await this.refreshStatusFromLines(manager, order, persistedItems as OrderItem[]);
      }

      // Breadcrumb so pm2 logs show who edited what and how.
      // eslint-disable-next-line no-console
      console.log(
        `[orders.updateItems] order=${order.orderNumber} userId=${userId} lines=${persistedItems.length} grandTotal=${grandTotal} paid=${paid}`,
      );

      // History event (Sally, 9 Sep: "product add ons history as well").
      // Refunds/payments/exchanges have their own tables; item edits had
      // no record at all — diff old vs new per SKU and write one
      // human-readable order_events row. Description is final display
      // text (includes who), so the timeline renders it without joins.
      try {
        const agg = (
          rows: Array<{ sku?: string; name?: string; quantity?: number; unitPrice?: number }>,
        ) => {
          const m = new Map<string, { name: string; qty: number; price: number }>();
          for (const r of rows) {
            const key = r.sku || r.name || '?';
            const cur = m.get(key);
            if (cur) cur.qty += Number(r.quantity) || 0;
            else
              m.set(key, {
                name: r.name || key,
                qty: Number(r.quantity) || 0,
                price: Number(r.unitPrice) || 0,
              });
          }
          return m;
        };
        const before = agg(oldItems);
        const after = agg(persistedItems);
        const changes: string[] = [];
        for (const [sku, a] of after) {
          const b = before.get(sku);
          if (!b) changes.push(`Added ${a.qty}× ${a.name}`);
          else {
            if (a.qty !== b.qty)
              changes.push(`${a.name}: qty ${b.qty} → ${a.qty}`);
            if (Math.abs(a.price - b.price) > 0.005)
              changes.push(
                `${a.name}: price $${b.price.toFixed(2)} → $${a.price.toFixed(2)}`,
              );
          }
        }
        for (const [sku, b] of before) {
          if (!after.has(sku)) changes.push(`Removed ${b.qty}× ${b.name}`);
        }
        if (Math.abs(cart.amount - cartDiscount) > 0.005) {
          changes.push(`order discount $${cart.amount.toFixed(2)} → $${cartDiscount.toFixed(2)}`);
        }
        changes.push(...splitChanges);
        if (changes.length > 0) {
          const editor = await manager.findOne(User, { where: { id: userId } });
          const who = editor
            ? [editor.firstName, editor.lastName].filter(Boolean).join(' ')
            : `user #${userId}`;
          await manager.save(
            manager.create(OrderEvent, {
              orderId: order.id,
              userId,
              type: 'items_changed',
              description:
                `Items changed by ${who}: ${changes.join('; ')}. New total $${grandTotal.toFixed(2)}.` +
                (completedNow ? ' Lay-by completed.' : ''),
            }),
          );
        }
      } catch (evErr) {
        // The audit trail must never fail the edit itself.
        // eslint-disable-next-line no-console
        console.error(
          `[orders.updateItems] event write failed for order ${order.id}:`,
          evErr,
        );
      }

      return (await manager.findOne(Order, {
        where: { id: orderId },
        relations: ['customer', 'user', 'items', 'payments'],
      })) as Order;
    });
  }

  // Timeline events for an order (currently item add/remove/qty/price
  // edits). Refunds, payments and exchanges are derived from their own
  // tables by the frontend timeline.
  async getEvents(orderId: number): Promise<OrderEvent[]> {
    return this.orderEventRepository.find({
      where: { orderId },
      order: { id: 'DESC' },
    });
  }

  /**
   * Correct a previously-recorded payment amount on an open order.
   * If the recorded amount was wrong (cashier over- or under-typed),
   * this rewrites the payment.amount and recomputes paymentStatus. No
   * refund is issued — for actual money back use the refund flow.
   * Blocks when the order is complete/refunded/cancelled.
   */
  async adjustPayment(
    orderId: number,
    paymentId: number,
    newAmount: number,
    userId: number,
  ): Promise<Order> {
    const frozenStatuses = new Set<OrderStatus>([
      OrderStatus.COMPLETE,
      OrderStatus.CANCELLED,
      OrderStatus.REFUNDED,
    ]);
    if (!(newAmount >= 0)) {
      throw new BadRequestException('Payment amount must be >= 0');
    }
    return this.dataSource.transaction(async (manager) => {
      const order = await manager.findOne(Order, { where: { id: orderId } });
      if (!order) throw new BadRequestException('Order not found');
      if (frozenStatuses.has(order.status)) {
        throw new BadRequestException(
          `Order is ${order.status} — payment cannot be adjusted.`,
        );
      }
      const payment = await manager.findOne(Payment, {
        where: { id: paymentId, orderId },
      });
      if (!payment) throw new BadRequestException('Payment not found on this order');

      const rounded = Math.round(newAmount * 100) / 100;
      payment.amount = rounded;
      await manager.save(payment);

      // Recalculate payment status against the (unchanged) grand total.
      const paid = await this.sumPaidForOrder(orderId);
      const grandTotal = Number(order.grandTotal);
      if (paid >= grandTotal - 0.01) {
        order.paymentStatus = PaymentStatus.PAID;
      } else if (paid > 0) {
        order.paymentStatus = PaymentStatus.PARTIAL;
      } else {
        order.paymentStatus = PaymentStatus.PENDING;
      }
      order.updatedAt = new Date();
      await manager.save(order);

      // eslint-disable-next-line no-console
      console.log(
        `[orders.adjustPayment] order=${order.orderNumber} payment=${paymentId} userId=${userId} newAmount=${rounded} paid=${paid} status=${order.paymentStatus}`,
      );
      return (await this.findById(orderId)) as Order;
    });
  }

  // Change how a recorded payment was taken — e.g. EFTPOS declined after
  // the sale was put through and the customer paid cash (Sally, 13 Oct
  // 2026). The amount doesn't change, so this is allowed on completed
  // orders too; it's logged in the order history with who did it. Store
  // credit is excluded both ways because it moves the customer's credit
  // balance, which a relabel can't do.
  async changePaymentMethod(
    orderId: number,
    paymentId: number,
    method: string,
    reference: string | undefined,
    userId: number,
  ): Promise<Order> {
    const allowed = [PaymentMethod.CASH, PaymentMethod.EFTPOS, PaymentMethod.BANK_TRANSFER];
    if (!allowed.includes(method as PaymentMethod)) {
      throw new BadRequestException('Payment can be changed to Cash, EFTPOS or Bank Transfer');
    }
    return this.dataSource.transaction(async (manager) => {
      const order = await manager.findOne(Order, { where: { id: orderId } });
      if (!order) throw new BadRequestException('Order not found');
      const payment = await manager.findOne(Payment, { where: { id: paymentId, orderId } });
      if (!payment) throw new BadRequestException('Payment not found on this order');
      if (payment.method === PaymentMethod.STORE_CREDIT) {
        throw new BadRequestException("A store credit payment can't be changed — refund it instead");
      }
      const label = (m: string) =>
        m === 'eftpos' ? 'EFTPOS' : m === 'bank_transfer' ? 'Bank Transfer' : m === 'cash' ? 'Cash' : m;
      const from = payment.method;
      if (from === method && reference === undefined) {
        return (await this.findById(orderId)) as Order;
      }
      payment.method = method as PaymentMethod;
      if (reference !== undefined) payment.reference = reference.trim() || null;
      // A cash tender figure means nothing on a card / transfer payment.
      if (method !== PaymentMethod.CASH) payment.amountTendered = null;
      await manager.save(payment);

      const editor = await manager.findOne(User, { where: { id: userId } });
      const who = editor
        ? [editor.firstName, editor.lastName].filter(Boolean).join(' ')
        : `user #${userId}`;
      await manager.save(
        manager.create(OrderEvent, {
          orderId,
          userId,
          type: 'payment_method_changed',
          description:
            `Payment of $${Number(payment.amount).toFixed(2)} changed from ${label(from)} to ` +
            `${label(method)} by ${who}.`,
        }),
      );
      // eslint-disable-next-line no-console
      console.log(
        `[orders.changePaymentMethod] order=${order.orderNumber} payment=${paymentId} ${from}->${method} userId=${userId}`,
      );
      return (await this.findById(orderId)) as Order;
    });
  }

  // -------------------------------------------------------------------
  // Layby + backorder helpers
  // -------------------------------------------------------------------

  /**
   * Sum of every completed payment against an order. Used to compute
   * layby balance due = grandTotal - paid.
   */
  private async sumPaidForOrder(orderId: number): Promise<number> {
    const row = await this.dataSource
      .createQueryBuilder(Payment, 'p')
      .where('p.orderId = :orderId', { orderId })
      .andWhere('p.status = :status', { status: PaymentEntityStatus.COMPLETED })
      .select('COALESCE(SUM(p.amount), 0)', 'total')
      .getRawOne();
    return Number(row?.total || 0);
  }

  async getLaybyBalance(orderId: number): Promise<{
    grandTotal: number;
    paid: number;
    balance: number;
  }> {
    const order = await this.orderRepository.findOne({ where: { id: orderId } });
    if (!order) throw new BadRequestException('Order not found');
    const grandTotal = Number(order.grandTotal);
    const paid = await this.sumPaidForOrder(orderId);
    const balance = Math.max(0, Math.round((grandTotal - paid) * 100) / 100);
    return { grandTotal, paid, balance };
  }

  /**
   * Record a balance-due payment against an open order. Works for
   * laybys (active or expired) and backorder-pending orders — both
   * flows are "deposit now, rest later". When the balance reaches 0:
   *   - Laybys complete immediately and push to Magento.
   *   - Backorder orders only complete if every backorder line is
   *     already fulfilled; otherwise paymentStatus flips to PAID but
   *     the order stays BACKORDER_PENDING until stock arrives.
   */
  async takeLaybyPayment(
    orderId: number,
    userId: number,
    dto: {
      amount: number;
      method: string;
      reference?: string;
      amountTendered?: number;
    },
  ): Promise<Order> {
    if (!dto.amount || dto.amount <= 0) {
      throw new BadRequestException('Payment amount must be greater than 0');
    }

    const order = await this.orderRepository.findOne({
      where: { id: orderId },
      relations: ['items'],
    });
    if (!order) throw new BadRequestException('Order not found');
    const isLaybyOrder = order.orderType === OrderType.LAYBY;
    // Any still-open order that took a deposit can collect its balance
    // here (Sally, 9 Sep: PAY button on deposit-paid backorders) —
    // laybys, backorder-pending, and plain pending/processing orders
    // that were part-paid. Closed orders (complete/refunded/cancelled)
    // still refuse.
    // COMPLETE too: a finished sale that had lights added owes the
    // difference (Sally, 4 Nov 2026). Nothing owed is refused below.
    const payableStatuses = new Set<OrderStatus>([
      OrderStatus.LAYBY_ACTIVE,
      OrderStatus.LAYBY_EXPIRED,
      OrderStatus.BACKORDER_PENDING,
      OrderStatus.PENDING,
      OrderStatus.PROCESSING,
      OrderStatus.COMPLETE,
    ]);
    if (!isLaybyOrder && !payableStatuses.has(order.status)) {
      throw new BadRequestException(
        `Cannot take balance payment on an order with status "${order.status}"`,
      );
    }

    const { balance } = await this.getLaybyBalance(orderId);
    const toApply = Math.min(Number(dto.amount), balance);
    if (toApply <= 0) {
      throw new BadRequestException('Layby balance is already paid in full');
    }

    const methodMap: Record<string, PaymentMethod> = {
      cash: PaymentMethod.CASH,
      eftpos: PaymentMethod.EFTPOS,
      credit_card: PaymentMethod.CREDIT_CARD,
      bank_transfer: PaymentMethod.BANK_TRANSFER,
      store_credit: PaymentMethod.STORE_CREDIT,
      other: PaymentMethod.OTHER,
    };
    const paymentMethod = methodMap[dto.method] || PaymentMethod.OTHER;

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    try {
      // If paying with store credit, verify the customer has the balance
      // and deduct from it inside the same transaction.
      if (paymentMethod === PaymentMethod.STORE_CREDIT) {
        if (!order.customerId) {
          throw new BadRequestException(
            'Store credit payments need a linked customer',
          );
        }
        await this.storeCreditService.assertSufficientBalance(
          order.customerId,
          toApply,
        );
      }

      const payment = queryRunner.manager.create(Payment, {
        orderId: order.id,
        userId,
        method: paymentMethod,
        amount: toApply,
        reference: dto.reference || null,
        amountTendered: dto.amountTendered || null,
        changeGiven: dto.amountTendered
          ? dto.amountTendered - toApply
          : null,
        status: PaymentEntityStatus.COMPLETED,
      });
      await queryRunner.manager.save(payment);

      if (paymentMethod === PaymentMethod.STORE_CREDIT && order.customerId) {
        await this.storeCreditService.redeemForOrder(
          queryRunner.manager,
          order.customerId,
          toApply,
          order.id,
          userId,
        );
      }

      // Check if the order is now fully paid.
      const newPaid = await queryRunner.manager
        .createQueryBuilder(Payment, 'p')
        .where('p.orderId = :orderId', { orderId: order.id })
        .andWhere('p.status = :status', {
          status: PaymentEntityStatus.COMPLETED,
        })
        .select('COALESCE(SUM(p.amount), 0)', 'total')
        .getRawOne();
      const paidTotal = Number(newPaid?.total || 0);
      const grandTotal = Number(order.grandTotal);
      const isFullyPaid = paidTotal + 0.01 >= grandTotal;

      // Backorder orders can't complete until every backorder line is
      // fulfilled (stock has arrived). They just go to PAID.
      const hasOutstandingBackorder = (order.items || []).some(
        (i) => i.isBackorder && !i.backorderFulfilledAt,
      );

      if (isFullyPaid) {
        order.paymentStatus = PaymentStatus.PAID;
        if (!hasOutstandingBackorder) {
          order.status = OrderStatus.COMPLETE;
        }
      } else {
        order.paymentStatus = PaymentStatus.PARTIAL;
      }
      await queryRunner.manager.save(order);

      await queryRunner.commitTransaction();

      // Push to Magento only when the order is actually complete. For
      // laybys that means fully paid; for backorder orders that means
      // fully paid AND all stock arrived.
      if (isFullyPaid && !hasOutstandingBackorder && isLaybyOrder) {
        this.syncService
          .pushOrderToMagentoWithRetry(order.id)
          .catch((err) => {
            // eslint-disable-next-line no-console
            console.error(
              `[pushOrderToMagento] layby ${order.id}:`,
              err,
            );
          });
      }

      return (await this.findById(order.id)) as Order;
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Cancel an active layby. Releases reserved stock back to inventory.
   * `refundAsStoreCredit` — return the deposit(s) to the customer as
   * store credit. `forfeitDeposit` — keep the deposit (admin option,
   * e.g. after no-show + expiry).
   */
  async cancelLayby(
    orderId: number,
    userId: number,
    opts: { reason?: string; refundAsStoreCredit?: boolean } = {},
  ): Promise<Order> {
    const order = await this.orderRepository.findOne({
      where: { id: orderId },
      relations: ['items'],
    });
    if (!order) throw new BadRequestException('Order not found');
    if (order.orderType !== OrderType.LAYBY) {
      throw new BadRequestException('Order is not a layby');
    }
    if (
      order.status !== OrderStatus.LAYBY_ACTIVE &&
      order.status !== OrderStatus.LAYBY_EXPIRED
    ) {
      throw new BadRequestException(
        `Cannot cancel layby with status "${order.status}"`,
      );
    }

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    try {
      // Release stock for items the store is still holding. Backorder
      // lines never took stock (so nothing to release). For mixed
      // orders, take-now lines have already been handed to the
      // customer — we can't reclaim their stock on cancel. Only the
      // isLaybyHeld lines (and, for pure legacy laybys with no per-line
      // flags, all non-backorder lines) get released.
      const isPureLegacyLayby = !order.items.some((i) => i.isLaybyHeld);
      for (const item of order.items) {
        if (!item.productId || item.isBackorder) continue;
        const shouldReleaseStock = isPureLegacyLayby || item.isLaybyHeld;
        if (!shouldReleaseStock) continue;
        await queryRunner.manager.update(
          'products',
          { id: item.productId },
          {
            stockQty: () => `stock_qty + ${item.quantity}`,
            isInStock: () => `1`,
          },
        );
      }

      // Optionally issue store credit for what was paid.
      if (opts.refundAsStoreCredit && order.customerId) {
        const paid = await this.sumPaidForOrder(order.id);
        if (paid > 0) {
          await this.storeCreditService.issueFromRefund(
            queryRunner.manager,
            order.customerId,
            paid,
            order.id, // using orderId as a related ref since there's no Refund row
            userId,
          );
        }
      }

      order.status = OrderStatus.CANCELLED;
      order.notes = [order.notes, opts.reason ? `Cancelled: ${opts.reason}` : null]
        .filter(Boolean)
        .join('\n');
      await queryRunner.manager.save(order);

      await queryRunner.commitTransaction();
      return (await this.findById(order.id)) as Order;
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Mark any active laybys whose expiry has passed as LAYBY_EXPIRED so
   * they surface on the list for admin review. Intended to be called on
   * a schedule or on demand. Returns the number of orders touched.
   */
  async expireLaybys(): Promise<number> {
    const result = await this.orderRepository
      .createQueryBuilder()
      .update(Order)
      .set({ status: OrderStatus.LAYBY_EXPIRED })
      .where('orderType = :type', { type: OrderType.LAYBY })
      .andWhere('status = :status', { status: OrderStatus.LAYBY_ACTIVE })
      .andWhere('laybyExpiresAt IS NOT NULL')
      .andWhere('laybyExpiresAt < :now', { now: new Date() })
      .execute();
    return result.affected || 0;
  }

  /**
   * Mark one or more backorder line items as fulfilled (stock arrived).
   * Decrements stock and, if every backorder line on the order is now
   * fulfilled, transitions the order from BACKORDER_PENDING to COMPLETE.
   */
  // Per-line status change from the order screen (Sally, 10 Sep: "click
  // on individual product line items... status drop down: Back Order /
  // Lay-by / Paid"). Rewrites the line's flags, nudges the order-level
  // status for standard orders, and writes a timeline event.
  //
  // NOTE: 'paid' on an open backorder line clears the flag WITHOUT the
  // stock decrement that "mark as received" (fulfillBackorderItems)
  // performs — use the green tick when stock has physically arrived.
  /**
   * The cart-level part of an order's discount ("Apply Further Discount").
   * It sits on the order, not on a line — lines keep their own price and
   * line discount — so it is the order's discount less the lines'.
   * `percent` is set when it was given as a % (from the discount audit).
   * POS sales only: website and legacy orders don't store it this way.
   * Needs the sale's cart entry in the discount audit, so a cent of
   * rounding between line discounts never reads as a discount.
   */
  async getCartDiscount(
    order: Pick<Order, 'id' | 'discountAmount' | 'source'>,
    items: Array<{ discountAmount?: number | string | null }>,
    db: { query: (sql: string, params?: unknown[]) => Promise<any> } = this.dataSource,
  ): Promise<{ amount: number; percent: number | null }> {
    if (order.source && order.source !== OrderSource.POS) return { amount: 0, percent: null };
    const lineDiscounts = items.reduce((t, i) => t + Number(i.discountAmount || 0), 0);
    const amount = Math.round((Number(order.discountAmount || 0) - lineDiscounts) * 100) / 100;
    if (amount <= 0.005) return { amount: 0, percent: null };
    const rows = await db.query(
      `SELECT discount_percent pct FROM discount_audit_log
        WHERE order_id = ? AND discount_type = 'cart' ORDER BY id DESC LIMIT 1`,
      [order.id],
    );
    if (!rows?.length) return { amount: 0, percent: null };
    const pct = Number(rows[0].pct || 0);
    return { amount, percent: pct > 0 ? pct : null };
  }

  /**
   * After a line changes status the order follows its lines. Standard
   * order: any open back order => BACKORDER_PENDING; else any line held on
   * lay-by => LAYBY_ACTIVE (Sally, 29 Oct 2026: POS-0423 showed COMPLETE
   * with its fans on lay-by); none left => COMPLETE if paid in full, else
   * PENDING so the balance can be collected. Lay-by: paid in full with
   * nothing held or on back order => COMPLETE. Returns true when it
   * completed a lay-by.
   */
  private async refreshStatusFromLines(
    manager: EntityManager,
    order: Order,
    items: OrderItem[],
  ): Promise<boolean> {
    const paidSoFar = async (): Promise<number> => {
      const paidRow = await manager
        .createQueryBuilder(Payment, 'p')
        .where('p.orderId = :orderId', { orderId: order.id })
        .andWhere('p.status = :status', { status: PaymentEntityStatus.COMPLETED })
        .select('COALESCE(SUM(p.amount), 0)', 'total')
        .getRawOne();
      return Number(paidRow?.total || 0);
    };
    if (order.orderType !== 'layby') {
      const openBackorder = items.some((i) => i.isBackorder && !i.backorderFulfilledAt);
      const movable = new Set<string>([
        OrderStatus.PENDING,
        OrderStatus.COMPLETE,
        OrderStatus.BACKORDER_PENDING,
        OrderStatus.LAYBY_ACTIVE,
      ]);
      if (movable.has(order.status)) {
        if (openBackorder) {
          order.status = OrderStatus.BACKORDER_PENDING;
        } else if (items.some((i) => i.isLaybyHeld)) {
          order.status = OrderStatus.LAYBY_ACTIVE;
        } else {
          const balanceOwed = (await paidSoFar()) + 0.01 < Number(order.grandTotal);
          order.status = balanceOwed ? OrderStatus.PENDING : OrderStatus.COMPLETE;
          if (!balanceOwed) order.paymentStatus = PaymentStatus.PAID;
        }
        await manager.update(Order, { id: order.id }, {
          status: order.status,
          paymentStatus: order.paymentStatus,
        });
      }
      return false;
    }
    if (
      order.status === OrderStatus.LAYBY_ACTIVE ||
      order.status === OrderStatus.LAYBY_EXPIRED
    ) {
      const stillOpen = items.some(
        (i) => (i.isBackorder && !i.backorderFulfilledAt) || i.isLaybyHeld,
      );
      if (!stillOpen && (await paidSoFar()) + 0.01 >= Number(order.grandTotal)) {
        order.status = OrderStatus.COMPLETE;
        order.paymentStatus = PaymentStatus.PAID;
        await manager.update(Order, { id: order.id }, {
          status: order.status,
          paymentStatus: order.paymentStatus,
        });
        return true;
      }
    }
    return false;
  }

  /**
   * The customer takes some of what is still owed on an order — part of
   * a back order or lay-by (Sally, 23 Oct 2026: POS-0342 ordered 18 of
   * each, took 2 and will "draw down" more each week; POS-0340 wants 1 of
   * its 2 fans). Each line given is split: the units taken become a taken
   * line, the rest stay on back order / lay-by with their PO and
   * supplier. Prices and the order total don't change.
   */
  async collectItems(
    orderId: number,
    lines: Array<{ itemId: number; qty: number }>,
    userId: number,
  ): Promise<Order> {
    const wanted = (Array.isArray(lines) ? lines : [])
      .map((l) => ({ itemId: Number(l?.itemId), qty: Math.floor(Number(l?.qty) || 0) }))
      .filter((l) => l.qty > 0);
    if (!wanted.length) {
      throw new BadRequestException('Enter how many of each item the customer is taking');
    }
    if (new Set(wanted.map((l) => l.itemId)).size !== wanted.length) {
      throw new BadRequestException('Each item can only be listed once');
    }
    await this.dataSource.transaction(async (manager) => {
      const order = await manager.findOne(Order, {
        where: { id: orderId },
        relations: ['items'],
      });
      if (!order) throw new BadRequestException('Order not found');
      if (order.status === OrderStatus.CANCELLED || order.status === OrderStatus.REFUNDED) {
        throw new BadRequestException(
          `Order ${order.orderNumber} is ${order.status} — nothing can be collected`,
        );
      }
      // Kept off `order` so nothing cascades through it (see updateItems).
      const items: OrderItem[] = order.items || [];
      delete (order as Partial<Order>).items;
      const refunded = new Set<number>(
        (
          await manager.query(
            `SELECT DISTINCT order_item_id id FROM refund_items WHERE order_item_id IN (?)`,
            [wanted.map((w) => w.itemId)],
          )
        ).map((r: { id: number | string }) => Number(r.id)),
      );
      const r2 = (n: number) => Math.round(n * 100) / 100;
      const taken: string[] = [];
      for (const w of wanted) {
        const item = items.find((i) => i.id === w.itemId);
        if (!item) throw new BadRequestException(`Item ${w.itemId} is not on this order`);
        const open = (item.isBackorder && !item.backorderFulfilledAt) || item.isLaybyHeld;
        if (!open) throw new BadRequestException(`${item.name} has already been taken`);
        if (refunded.has(item.id)) {
          throw new BadRequestException(`${item.name} has a refund on it — use Refund / Exchange instead`);
        }
        if (w.qty > item.quantity) {
          throw new BadRequestException(`Only ${item.quantity}× ${item.name} left to collect`);
        }
        const was = item.isLaybyHeld ? 'lay-by' : 'back order';
        if (w.qty === item.quantity) {
          await manager.update(OrderItem, { id: item.id }, {
            isBackorder: false,
            backorderFulfilledAt: null,
            backorderQty: null,
            isLaybyHeld: false,
          });
          item.isBackorder = false;
          item.backorderFulfilledAt = null;
          item.isLaybyHeld = false;
        } else {
          const qty = Number(item.quantity);
          const part = (v: number | string | null) => r2((Number(v || 0) / qty) * w.qty);
          const takenRow = manager.create(OrderItem, {
            orderId: order.id,
            productId: item.productId,
            sku: item.sku,
            name: item.name,
            quantity: w.qty,
            unitPrice: item.unitPrice,
            discountPercent: item.discountPercent,
            discountAmount: part(item.discountAmount),
            taxAmount: part(item.taxAmount),
            rowTotal: part(item.rowTotal),
            costPrice: item.costPrice,
            supplier: item.supplier,
            poNumber: item.poNumber,
            poSentAt: item.poSentAt,
            isBackorder: false,
            backorderFulfilledAt: null,
            backorderQty: null,
            isLaybyHeld: false,
          });
          // The rest keeps whatever is left so the two halves add up exactly.
          const rest = {
            quantity: qty - w.qty,
            discountAmount: r2(Number(item.discountAmount || 0) - Number(takenRow.discountAmount)),
            taxAmount: r2(Number(item.taxAmount || 0) - Number(takenRow.taxAmount)),
            rowTotal: r2(Number(item.rowTotal || 0) - Number(takenRow.rowTotal)),
            backorderQty: null,
          };
          await manager.update(OrderItem, { id: item.id }, rest);
          Object.assign(item, rest);
          items.push(await manager.save(takenRow));
        }
        taken.push(`${w.qty}× ${item.name} (was ${was})`);
      }

      const completedNow = await this.refreshStatusFromLines(manager, order, items);
      const stillOwed = items
        .filter((i) => (i.isBackorder && !i.backorderFulfilledAt) || i.isLaybyHeld)
        .map((i) => `${i.quantity}× ${i.name}`);
      try {
        const editor = await manager.findOne(User, { where: { id: userId } });
        const who = editor
          ? [editor.firstName, editor.lastName].filter(Boolean).join(' ')
          : `user #${userId}`;
        await manager.save(
          manager.create(OrderEvent, {
            orderId: order.id,
            userId,
            type: 'collected',
            description:
              `Customer collected ${taken.join(', ')} — ${who}. ` +
              (stillOwed.length ? `Still to collect: ${stillOwed.join(', ')}.` : 'Nothing left to collect.') +
              (completedNow ? ' Lay-by completed.' : ''),
          }),
        );
      } catch (evErr) {
        // eslint-disable-next-line no-console
        console.error(`[orders.collectItems] event write failed for order ${orderId}:`, evErr);
      }
    });
    return (await this.findById(orderId)) as Order;
  }

  async setItemStatus(
    orderId: number,
    itemId: number,
    status: 'backorder' | 'layby' | 'paid',
    userId: number,
  ): Promise<Order> {
    const order = await this.orderRepository.findOne({
      where: { id: orderId },
      relations: ['items'],
    });
    if (!order) throw new BadRequestException('Order not found');
    if (
      order.status === OrderStatus.CANCELLED ||
      order.status === OrderStatus.REFUNDED
    ) {
      throw new BadRequestException(
        `Order ${order.orderNumber} is ${order.status} — item status can't be changed`,
      );
    }
    const item = order.items.find((i) => i.id === itemId);
    if (!item) throw new BadRequestException(`Item ${itemId} is not on this order`);

    const labelOf = (i: OrderItem): string =>
      i.isBackorder && !i.backorderFulfilledAt
        ? 'Back Order'
        : i.isLaybyHeld
          ? 'Lay-by'
          : 'Paid';
    const before = labelOf(item);

    if (status === 'backorder') {
      item.isBackorder = true;
      item.backorderFulfilledAt = null;
      item.isLaybyHeld = false;
    } else if (status === 'layby') {
      item.isLaybyHeld = true;
      item.isBackorder = false;
      item.backorderFulfilledAt = null;
    } else {
      item.isBackorder = false;
      item.backorderFulfilledAt = null;
      item.isLaybyHeld = false;
    }
    const after = labelOf(item);
    // Picking the status a line already has still re-checks the order —
    // that's how a fully paid lay-by whose lines are all taken gets
    // completed (Sally, 20 Oct 2026: POS-0117 stuck on LAY BY).
    const changed = before !== after;

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    try {
      if (changed) await queryRunner.manager.save(item);
      const completedNow = await this.refreshStatusFromLines(
        queryRunner.manager,
        order,
        order.items,
      );

      if (!changed && !completedNow) {
        await queryRunner.commitTransaction();
        return (await this.findById(orderId)) as Order;
      }

      try {
        const editor = await queryRunner.manager.findOne(User, { where: { id: userId } });
        const who = editor
          ? [editor.firstName, editor.lastName].filter(Boolean).join(' ')
          : `user #${userId}`;
        if (changed) {
          await queryRunner.manager.save(
            queryRunner.manager.create(OrderEvent, {
              orderId,
              userId,
              type: 'item_status',
              description: `${item.quantity}x ${item.name}: status changed from ${before} to ${after} by ${who}.`,
            }),
          );
        }
        if (completedNow) {
          await queryRunner.manager.save(
            queryRunner.manager.create(OrderEvent, {
              orderId,
              userId,
              type: 'completed',
              description: `Lay-by completed — paid in full and every item taken (${who}).`,
            }),
          );
        }
      } catch (evErr) {
        // eslint-disable-next-line no-console
        console.error(`[orders.setItemStatus] event write failed for order ${orderId}:`, evErr);
      }

      await queryRunner.commitTransaction();
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.release();
    }
    return (await this.findById(orderId)) as Order;
  }

  async fulfillBackorderItems(
    orderId: number,
    itemIds: number[],
  ): Promise<Order> {
    if (!itemIds || itemIds.length === 0) {
      throw new BadRequestException('No items to fulfil');
    }
    const order = await this.orderRepository.findOne({
      where: { id: orderId },
      relations: ['items'],
    });
    if (!order) throw new BadRequestException('Order not found');

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    try {
      for (const id of itemIds) {
        const item = order.items.find((i) => i.id === id);
        if (!item) {
          throw new BadRequestException(`Item ${id} is not on this order`);
        }
        if (!item.isBackorder) {
          throw new BadRequestException(
            `Item ${id} is not flagged as a backorder`,
          );
        }
        if (item.backorderFulfilledAt) {
          continue; // already fulfilled
        }
        item.backorderFulfilledAt = new Date();
        await queryRunner.manager.save(item);

        if (item.productId) {
          await queryRunner.manager.update(
            'products',
            { id: item.productId },
            {
              stockQty: () => `stock_qty - ${item.quantity}`,
              isInStock: () =>
                `CASE WHEN stock_qty - ${item.quantity} > 0 THEN 1 ELSE 0 END`,
            },
          );
        }
      }

      // If everything is now fulfilled AND the balance is paid, flip
      // the order to COMPLETE — or LAY BY while any line is still held
      // for the customer (Sally, 29 Oct 2026). If the customer still
      // owes money, keep the order PENDING so the cashier can collect
      // the balance via Take Payment before closing it out.
      const refreshed = await queryRunner.manager.findOne(Order, {
        where: { id: orderId },
        relations: ['items'],
      });
      const outstanding =
        refreshed?.items?.some(
          (i) => i.isBackorder && !i.backorderFulfilledAt,
        ) ?? false;
      if (!outstanding && refreshed) {
        const paidRow = await queryRunner.manager
          .createQueryBuilder(Payment, 'p')
          .where('p.orderId = :orderId', { orderId })
          .andWhere('p.status = :status', {
            status: PaymentEntityStatus.COMPLETED,
          })
          .select('COALESCE(SUM(p.amount), 0)', 'total')
          .getRawOne();
        const paidTotal = Number(paidRow?.total || 0);
        const grandTotal = Number(refreshed.grandTotal);
        const balanceOwed = paidTotal + 0.01 < grandTotal;
        if (!balanceOwed) {
          refreshed.status = refreshed.items.some((i) => i.isLaybyHeld)
            ? OrderStatus.LAYBY_ACTIVE
            : OrderStatus.COMPLETE;
          refreshed.paymentStatus = PaymentStatus.PAID;
        }
        await queryRunner.manager.save(refreshed);
      }

      await queryRunner.commitTransaction();
      return (await this.findById(order.id)) as Order;
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.release();
    }
  }
}
