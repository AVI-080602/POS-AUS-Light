import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DiscountAuditLog, DiscountType } from './entities';
import {
  ValidateDiscountDto,
  CartItemDto,
  CartDiscountDto,
} from './dto/validate-discount.dto';
import { ConfigService } from '@nestjs/config';
import { RoleNames } from '../auth/decorators/roles.decorator';

export interface DiscountValidationResult {
  isValid: boolean;
  errors: DiscountError[];
  warnings: string[];
  calculatedTotals: CalculatedTotals;
  auditEntries: AuditEntry[];
}

export interface DiscountError {
  code: string;
  message: string;
  field?: string;
  attemptedValue?: number;
  maxAllowed?: number;
}

export interface CalculatedItem {
  productId: number;
  sku: string;
  name: string;
  quantity: number;
  unitPrice: number;
  discountPercent: number;
  discountAmount: number;
  taxAmount: number;
  rowTotal: number;
}

export interface CalculatedTotals {
  items: CalculatedItem[];
  subtotal: number;
  itemDiscounts: number;
  cartDiscount: number;
  totalDiscount: number;
  taxAmount: number;
  grandTotal: number;
}

export interface AuditEntry {
  type: DiscountType;
  productId?: number;
  attemptedPercent: number;
  wasRejected: boolean;
  rejectionReason?: string;
}

export interface UserRole {
  id: number;
  name: string;
  maxDiscountPercent: number;
  canStackDiscounts: boolean;
}

@Injectable()
export class DiscountsService {
  private readonly logger = new Logger(DiscountsService.name);
  private readonly taxRate: number;

  constructor(
    @InjectRepository(DiscountAuditLog)
    private readonly auditLogRepository: Repository<DiscountAuditLog>,
    private readonly configService: ConfigService,
  ) {
    this.taxRate = parseFloat(
      this.configService.get<string>('TAX_RATE', '0.10'),
    );
  }

  /**
   * Main validation function - enforces all discount rules
   */
  validateAndCalculate(
    dto: ValidateDiscountDto,
    userRole: UserRole,
  ): DiscountValidationResult {
    const errors: DiscountError[] = [];
    const warnings: string[] = [];
    const auditEntries: AuditEntry[] = [];

    // Step 1: Validate individual product discounts
    for (const item of dto.items) {
      if (item.discountPercent && item.discountPercent > 0) {
        const validation = this.validateProductDiscount(
          item.discountPercent,
          userRole,
        );

        if (!validation.isValid) {
          errors.push({
            code: 'DISCOUNT_EXCEEDS_LIMIT',
            message: `Product discount of ${item.discountPercent}% exceeds your maximum of ${userRole.maxDiscountPercent}%`,
            field: `items.${item.productId}.discountPercent`,
            attemptedValue: item.discountPercent,
            maxAllowed: userRole.maxDiscountPercent,
          });

          auditEntries.push({
            type: DiscountType.PRODUCT,
            productId: item.productId,
            attemptedPercent: item.discountPercent,
            wasRejected: true,
            rejectionReason: 'EXCEEDS_ROLE_LIMIT',
          });
        }
      }
    }

    // Step 2: Validate cart-level discount
    if (dto.cartDiscount && dto.cartDiscount.value > 0) {
      if (dto.cartDiscount.type === 'percent') {
        const validation = this.validateCartDiscount(
          dto.cartDiscount.value,
          userRole,
        );

        if (!validation.isValid) {
          errors.push({
            code: 'DISCOUNT_EXCEEDS_LIMIT',
            message: `Cart discount of ${dto.cartDiscount.value}% exceeds your maximum of ${userRole.maxDiscountPercent}%`,
            field: 'cartDiscount.value',
            attemptedValue: dto.cartDiscount.value,
            maxAllowed: userRole.maxDiscountPercent,
          });

          auditEntries.push({
            type: DiscountType.CART,
            attemptedPercent: dto.cartDiscount.value,
            wasRejected: true,
            rejectionReason: 'EXCEEDS_ROLE_LIMIT',
          });
        }
      }
    }

    // Step 3: Check stacking rules. A sale carries EITHER item-level
    // discounts OR a cart-level discount, never both — a hard rule for
    // all roles (Sally's policy: "it has to be one or the other"),
    // regardless of canStackDiscounts.
    const hasProductDiscounts = dto.items.some(
      (item) => item.discountPercent && item.discountPercent > 0,
    );
    const hasCartDiscount =
      dto.cartDiscount && dto.cartDiscount.value > 0;

    if (hasProductDiscounts && hasCartDiscount) {
      errors.push({
        code: 'STACKING_NOT_ALLOWED',
        message:
          'Only one discount is allowed per sale — either an item discount or a further (cart) discount, not both.',
        field: 'cartDiscount',
      });

      auditEntries.push({
        type: DiscountType.CART,
        attemptedPercent: dto.cartDiscount?.value || 0,
        wasRejected: true,
        rejectionReason: 'STACKING_NOT_ALLOWED',
      });
    }

    // Step 3b: Cap a FIXED cart discount to the same percentage limit so
    // staff can't knock the whole price off (e.g. $20 off a $20 item).
    if (
      dto.cartDiscount &&
      dto.cartDiscount.type === 'fixed' &&
      dto.cartDiscount.value > 0
    ) {
      const subtotal = dto.items.reduce(
        (sum, it) => sum + it.unitPrice * it.quantity,
        0,
      );
      // Fixed discount can never exceed the subtotal (can't discount
      // more than the price), and is further capped to the role's %.
      const cap =
        Math.round(
          Math.min(subtotal, (userRole.maxDiscountPercent / 100) * subtotal) *
            100,
        ) / 100;
      if (dto.cartDiscount.value > cap) {
        errors.push({
          code: 'DISCOUNT_EXCEEDS_LIMIT',
          message: `Fixed discount $${dto.cartDiscount.value.toFixed(2)} exceeds the maximum $${cap.toFixed(2)} (can't discount more than the $${subtotal.toFixed(2)} sale).`,
          field: 'cartDiscount.value',
          attemptedValue: dto.cartDiscount.value,
          maxAllowed: cap,
        });
        auditEntries.push({
          type: DiscountType.CART,
          attemptedPercent: dto.cartDiscount.value,
          wasRejected: true,
          rejectionReason: 'FIXED_EXCEEDS_PERCENT_CAP',
        });
      }
    }

    // Step 4: Calculate totals
    const calculatedTotals = this.calculateCartTotals(
      dto.items,
      dto.cartDiscount,
      errors.length > 0, // If errors, calculate without discounts
    );

    // Step 5: Add warnings for high discounts
    const totalDiscountPercent = this.calculateEffectiveDiscountPercent(
      dto.items,
      dto.cartDiscount,
    );

    if (totalDiscountPercent > 15 && errors.length === 0) {
      warnings.push(
        `High discount alert: Effective discount is ${totalDiscountPercent.toFixed(1)}%`,
      );
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      calculatedTotals,
      auditEntries,
    };
  }

  /**
   * Minimum-margin guard: an item can't be sold for less than cost + 30%
   * (per Sally's spec in the POS feedback sheet).
   * Managers/admins may override; sales_staff cannot. Skips items with no
   * known cost (unmatched SKUs, custom items) — nothing to enforce against.
   * Deliberately omits the cost/floor figures from the returned errors so a
   * sales_staff request can never learn the cost via the response.
   */
  private static readonly MIN_MARGIN_MULTIPLIER = 1.3;

  checkCostFloor(
    items: Array<{
      sku: string;
      name?: string;
      unitPrice: number;
      cost?: number | null;
    }>,
    userRole: UserRole,
  ): DiscountError[] {
    if (
      userRole.name === RoleNames.MANAGER ||
      userRole.name === RoleNames.ADMIN
    ) {
      return [];
    }

    const errors: DiscountError[] = [];
    for (const item of items) {
      if (item.cost == null || item.cost <= 0) continue;
      const floor = item.cost * DiscountsService.MIN_MARGIN_MULTIPLIER;
      if (item.unitPrice < floor) {
        errors.push({
          code: 'BELOW_COST_FLOOR',
          message: `"${item.name || item.sku}" is priced below the minimum allowed margin — ask a manager or admin to proceed.`,
          field: `items.${item.sku}.unitPrice`,
        });
      }
    }
    return errors;
  }

  /**
   * Validate a product-level discount against role limits
   */
  private validateProductDiscount(
    discountPercent: number,
    userRole: UserRole,
  ): { isValid: boolean } {
    // Rule 1: Cannot be negative
    if (discountPercent < 0) {
      return { isValid: false };
    }

    // Rule 2: Cannot exceed 100%
    if (discountPercent > 100) {
      return { isValid: false };
    }

    // Rule 3: Must be within role's limit
    if (discountPercent > userRole.maxDiscountPercent) {
      return { isValid: false };
    }

    return { isValid: true };
  }

  /**
   * Validate a cart-level discount against role limits
   */
  private validateCartDiscount(
    discountPercent: number,
    userRole: UserRole,
  ): { isValid: boolean } {
    return this.validateProductDiscount(discountPercent, userRole);
  }

  /**
   * Calculate cart totals with discounts applied
   */
  calculateCartTotals(
    items: CartItemDto[],
    cartDiscount: CartDiscountDto | undefined,
    ignoreDiscounts: boolean = false,
  ): CalculatedTotals {
    let subtotal = 0;
    let itemDiscountTotal = 0;
    // Non-clearance portion — the only part a cart-level discount may
    // reduce. Clearance/sale items are already marked down.
    let discountableBase = 0;
    const calculatedItems: CalculatedItem[] = [];

    // Australian prices are GST-INCLUSIVE. Unit prices coming in already
    // contain GST, so we must NOT add 10% on top — we extract the GST
    // component for display (gross ÷ 11) instead. This mirrors the
    // frontend cart slice so order totals always agree.
    const GST_DIVISOR = 11;

    for (const item of items) {
      const lineSubtotal = item.unitPrice * item.quantity;
      subtotal += lineSubtotal;

      let discountAmount = 0;
      let discountPercent = 0;

      if (!ignoreDiscounts && item.discountPercent) {
        discountPercent = item.discountPercent;
        discountAmount = lineSubtotal * (discountPercent / 100);
        itemDiscountTotal += discountAmount;
      }

      const lineTotal = lineSubtotal - discountAmount; // gross (incl GST)
      if (!item.isSaleItem) discountableBase += lineTotal;
      const lineTax = lineTotal / GST_DIVISOR; // GST component of the gross

      calculatedItems.push({
        productId: item.productId,
        sku: item.sku || '',
        name: item.name || '',
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        discountPercent: ignoreDiscounts ? 0 : discountPercent,
        discountAmount: this.round(discountAmount),
        taxAmount: this.round(lineTax),
        // rowTotal is the gross amount the customer pays — GST is already in it
        rowTotal: this.round(lineTotal),
      });
    }

    // Apply cart discount — only against the non-clearance portion.
    // Clearance/sale items are excluded (already marked down).
    const afterItemDiscounts = subtotal - itemDiscountTotal;
    let cartDiscountAmount = 0;

    if (!ignoreDiscounts && cartDiscount && cartDiscount.value > 0) {
      if (cartDiscount.type === 'percent') {
        cartDiscountAmount = discountableBase * (cartDiscount.value / 100);
      } else {
        // Fixed amount discount
        cartDiscountAmount = Math.min(cartDiscount.value, discountableBase);
      }
    }

    const totalAfterDiscounts = afterItemDiscounts - cartDiscountAmount;
    // Grand total is the gross amount — GST is already baked into the prices.
    // We expose the extracted GST component for display/reporting.
    const taxAmount = totalAfterDiscounts / GST_DIVISOR;
    const grandTotal = totalAfterDiscounts;

    return {
      items: calculatedItems,
      subtotal: this.round(subtotal),
      itemDiscounts: this.round(itemDiscountTotal),
      cartDiscount: this.round(cartDiscountAmount),
      totalDiscount: this.round(itemDiscountTotal + cartDiscountAmount),
      taxAmount: this.round(taxAmount),
      grandTotal: this.round(grandTotal),
    };
  }

  /**
   * Calculate the effective total discount percentage
   */
  private calculateEffectiveDiscountPercent(
    items: CartItemDto[],
    cartDiscount: CartDiscountDto | undefined,
  ): number {
    const subtotal = items.reduce(
      (sum, item) => sum + item.unitPrice * item.quantity,
      0,
    );

    if (subtotal === 0) return 0;

    const totals = this.calculateCartTotals(items, cartDiscount, false);
    return (totals.totalDiscount / subtotal) * 100;
  }

  /**
   * Round to 2 decimal places
   */
  private round(value: number): number {
    return Math.round(value * 100) / 100;
  }

  /**
   * Log discount audit entries to database
   */
  async logDiscountAudit(
    orderId: number | null,
    userId: number,
    userRole: string,
    auditEntries: AuditEntry[],
    reason?: string,
  ): Promise<void> {
    for (const entry of auditEntries) {
      try {
        await this.auditLogRepository.save({
          orderId,
          userId,
          userRole,
          discountType: entry.type,
          discountPercent: entry.attemptedPercent,
          discountAmount: 0, // Will be filled when actual discount applied
          originalAmount: 0,
          finalAmount: 0,
          wasRejected: entry.wasRejected,
          rejectionReason: entry.rejectionReason || null,
          reason: reason || null,
        });
      } catch (error) {
        this.logger.error('Failed to log discount audit', error);
      }
    }
  }

  /**
   * Log successful discount application
   */
  async logAppliedDiscount(
    orderId: number,
    orderItemId: number | null,
    userId: number,
    userRole: string,
    discountType: DiscountType,
    discountPercent: number,
    discountAmount: number,
    originalAmount: number,
    finalAmount: number,
    isStacked: boolean = false,
    reason?: string,
  ): Promise<DiscountAuditLog> {
    return this.auditLogRepository.save({
      orderId,
      orderItemId,
      userId,
      userRole,
      discountType,
      discountPercent,
      discountAmount,
      originalAmount,
      finalAmount,
      isStacked,
      wasRejected: false,
      reason: reason || null,
    });
  }

  /**
   * Get discount audit history for an order
   */
  async getOrderDiscountHistory(orderId: number): Promise<DiscountAuditLog[]> {
    return this.auditLogRepository.find({
      where: { orderId },
      order: { createdAt: 'ASC' },
    });
  }

  /**
   * Get discount report for date range
   */
  async getDiscountReport(
    dateFrom: Date,
    dateTo: Date,
  ): Promise<{
    totalDiscountAmount: number;
    discountCount: number;
    averageDiscountPercent: number;
    rejectedDiscounts: number;
    byUser: Array<{
      userId: number;
      userRole: string;
      discountCount: number;
      totalAmount: number;
      averagePercent: number;
    }>;
  }> {
    const logs = await this.auditLogRepository
      .createQueryBuilder('log')
      .where('log.createdAt BETWEEN :dateFrom AND :dateTo', {
        dateFrom,
        dateTo,
      })
      .getMany();

    const successfulLogs = logs.filter((l) => !l.wasRejected);
    const rejectedCount = logs.filter((l) => l.wasRejected).length;

    const totalDiscountAmount = successfulLogs.reduce(
      (sum, l) => sum + parseFloat(l.discountAmount.toString()),
      0,
    );

    const averageDiscountPercent =
      successfulLogs.length > 0
        ? successfulLogs.reduce(
            (sum, l) => sum + parseFloat(l.discountPercent.toString()),
            0,
          ) / successfulLogs.length
        : 0;

    // Group by user
    const byUserMap = new Map<
      number,
      {
        userId: number;
        userRole: string;
        discountCount: number;
        totalAmount: number;
        totalPercent: number;
      }
    >();

    for (const log of successfulLogs) {
      const existing = byUserMap.get(log.userId);
      if (existing) {
        existing.discountCount++;
        existing.totalAmount += parseFloat(log.discountAmount.toString());
        existing.totalPercent += parseFloat(log.discountPercent.toString());
      } else {
        byUserMap.set(log.userId, {
          userId: log.userId,
          userRole: log.userRole,
          discountCount: 1,
          totalAmount: parseFloat(log.discountAmount.toString()),
          totalPercent: parseFloat(log.discountPercent.toString()),
        });
      }
    }

    const byUser = Array.from(byUserMap.values()).map((u) => ({
      userId: u.userId,
      userRole: u.userRole,
      discountCount: u.discountCount,
      totalAmount: this.round(u.totalAmount),
      averagePercent: this.round(u.totalPercent / u.discountCount),
    }));

    return {
      totalDiscountAmount: this.round(totalDiscountAmount),
      discountCount: successfulLogs.length,
      averageDiscountPercent: this.round(averageDiscountPercent),
      rejectedDiscounts: rejectedCount,
      byUser,
    };
  }
}
