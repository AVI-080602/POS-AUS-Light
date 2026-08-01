import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Order, OrderStatus } from './entities/order.entity';
import { OrderItem } from './entities/order-item.entity';
import { Refund, RefundReason } from './entities/refund.entity';
import { RefundItem } from './entities/refund-item.entity';
import { Product } from '../products/entities/product.entity';
import { StoreCreditService } from '../customers/store-credit.service';

export interface CreateRefundDto {
  reason: RefundReason;
  reasonText?: string;
  items: Array<{
    orderItemId: number;
    quantity: number;
    restock: boolean;
  }>;
  // When true, refund goes back as cash (no store credit is issued).
  // Defaults to false (store credit).
  asCash?: boolean;
  // When true, deduct a 20% restocking fee from the refund total.
  // Customer-changed-mind returns and the like — store keeps 20%.
  // Recorded in the reasonText so it shows on the refund history.
  applyRestockingFee?: boolean;
}

@Injectable()
export class RefundsService {
  constructor(
    @InjectRepository(Refund)
    private readonly refundRepository: Repository<Refund>,
    @InjectRepository(Order)
    private readonly orderRepository: Repository<Order>,
    private readonly dataSource: DataSource,
    private readonly storeCreditService: StoreCreditService,
  ) {}

  async create(orderId: number, userId: number, dto: CreateRefundDto): Promise<Refund> {
    // Validate reason + reason_text
    if (!Object.values(RefundReason).includes(dto.reason)) {
      throw new BadRequestException('Invalid refund reason');
    }
    if (dto.reason === RefundReason.OTHER && !dto.reasonText?.trim()) {
      throw new BadRequestException('Reason text is required when reason is "other"');
    }
    if (dto.reasonText && dto.reasonText.length > 500) {
      throw new BadRequestException('Reason text must be 500 characters or fewer');
    }
    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException('At least one item must be selected for refund');
    }

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // Load order with items + existing refunds
      const order = await queryRunner.manager.findOne(Order, {
        where: { id: orderId },
        relations: ['items'],
      });
      if (!order) throw new NotFoundException('Order not found');
      if (order.status === OrderStatus.REFUNDED) {
        throw new BadRequestException('Order has already been fully refunded');
      }
      if (order.status === OrderStatus.CANCELLED) {
        throw new BadRequestException('Cancelled orders cannot be refunded');
      }
      // Store-credit refunds require a linked customer. Cash refunds don't —
      // the customer walks away with cash and nothing needs to be tracked
      // against an account.
      if (!dto.asCash && !order.customerId) {
        throw new BadRequestException(
          'This order is not linked to a customer. Link a customer to issue store credit, or refund as cash.',
        );
      }

      // Fetch previously refunded quantities per order_item
      const previousRefundItems = await queryRunner.manager
        .createQueryBuilder(RefundItem, 'ri')
        .innerJoin('ri.refund', 'r')
        .where('r.orderId = :orderId', { orderId })
        .select('ri.orderItemId', 'orderItemId')
        .addSelect('SUM(ri.quantity)', 'totalRefundedQty')
        .groupBy('ri.orderItemId')
        .getRawMany();

      const alreadyRefundedMap = new Map<number, number>();
      for (const row of previousRefundItems) {
        alreadyRefundedMap.set(Number(row.orderItemId), Number(row.totalRefundedQty));
      }

      // Validate every requested item belongs to the order and qty is within limits
      const orderItemMap = new Map<number, OrderItem>();
      for (const oi of order.items) orderItemMap.set(oi.id, oi);

      let refundAmount = 0;
      const refundItemRows: Partial<RefundItem>[] = [];

      for (const reqItem of dto.items) {
        const orderItem = orderItemMap.get(reqItem.orderItemId);
        if (!orderItem) {
          throw new BadRequestException(
            `Order item ${reqItem.orderItemId} does not belong to this order`,
          );
        }
        if (reqItem.quantity <= 0) {
          throw new BadRequestException(`Refund quantity must be greater than 0`);
        }
        const alreadyRefunded = alreadyRefundedMap.get(orderItem.id) || 0;
        const remaining = orderItem.quantity - alreadyRefunded;
        if (reqItem.quantity > remaining) {
          throw new BadRequestException(
            `Cannot refund ${reqItem.quantity} of "${orderItem.name}"; only ${remaining} remaining to refund`,
          );
        }

        // Line unit price is GST-inclusive; rowTotal is after discount
        // Compute per-unit refund amount = rowTotal / original qty
        const originalQty = Number(orderItem.quantity);
        const rowTotal = Number(orderItem.rowTotal);
        const perUnit = originalQty > 0 ? rowTotal / originalQty : Number(orderItem.unitPrice);
        const lineRefund = Math.round(perUnit * reqItem.quantity * 100) / 100;
        refundAmount += lineRefund;

        refundItemRows.push({
          orderItemId: orderItem.id,
          quantity: reqItem.quantity,
          amount: lineRefund,
          restock: !!reqItem.restock,
        });

        // Restock if requested and product is linked
        if (reqItem.restock && orderItem.productId) {
          await queryRunner.manager.increment(
            Product,
            { id: orderItem.productId },
            'stockQty',
            reqItem.quantity,
          );
        }
      }

      refundAmount = Math.round(refundAmount * 100) / 100;

      // Apply 20% restocking fee if requested. Store keeps the fee;
      // customer is refunded the rest. Recorded in reasonText for the
      // refund history view.
      const RESTOCKING_FEE_PERCENT = 20;
      let restockingFee = 0;
      if (dto.applyRestockingFee) {
        restockingFee =
          Math.round((refundAmount * RESTOCKING_FEE_PERCENT) / 100 * 100) / 100;
        refundAmount = Math.round((refundAmount - restockingFee) * 100) / 100;
      }

      // Compute total refunded amount for this order after this refund
      const previousRefundTotalRows = await queryRunner.manager
        .createQueryBuilder(Refund, 'r')
        .where('r.orderId = :orderId', { orderId })
        .select('COALESCE(SUM(r.refundAmount), 0)', 'total')
        .getRawOne();
      const previousRefundedTotal = Number(previousRefundTotalRows?.total || 0);
      const newTotalRefunded = previousRefundedTotal + refundAmount;
      const orderGrandTotal = Number(order.grandTotal);

      // Determine if this refund fully completes the order refund.
      // When a restocking fee is taken, "full" means the customer can't
      // claim more items — even though they don't get the full $ back.
      const allItemsRefunded = order.items.every((oi) => {
        const alreadyRef = alreadyRefundedMap.get(oi.id) || 0;
        const newRef = dto.items.find((di) => di.orderItemId === oi.id)?.quantity || 0;
        return alreadyRef + newRef >= Number(oi.quantity);
      });
      const isFullRefund = dto.applyRestockingFee
        ? allItemsRefunded
        : newTotalRefunded >= orderGrandTotal - 0.01;

      // Create refund + items. Prepend "[CASH REFUND]" / "[20% RESTOCK FEE]"
      // tags to reasonText so they're visible on the refund list without
      // needing new schema columns.
      const tags: string[] = [];
      if (dto.asCash) tags.push('[CASH REFUND]');
      if (dto.applyRestockingFee) {
        tags.push(
          `[20% RESTOCK FEE: $${restockingFee.toFixed(2)} retained]`,
        );
      }
      const combinedReasonText =
        tags.length > 0
          ? `${tags.join(' ')} ${dto.reasonText?.trim() || ''}`.trim()
          : dto.reasonText?.trim() || null;
      const refund = queryRunner.manager.create(Refund, {
        orderId: order.id,
        userId,
        reason: dto.reason,
        reasonText: combinedReasonText,
        refundAmount,
        isFullRefund,
      } as Partial<Refund>);
      const savedRefund = await queryRunner.manager.save(refund);

      for (const row of refundItemRows) {
        const refundItem = queryRunner.manager.create(RefundItem, {
          ...row,
          refundId: savedRefund.id,
        } as Partial<RefundItem>);
        await queryRunner.manager.save(refundItem);
      }

      // Update order status
      order.status = isFullRefund ? OrderStatus.REFUNDED : OrderStatus.REFUND_IN_PROCESS;
      await queryRunner.manager.save(order);

      // Issue store credit to the customer — unless the cashier opted to
      // refund as cash. Runs inside the same transaction so a failure
      // rolls back the refund cleanly.
      if (!dto.asCash && order.customerId) {
        await this.storeCreditService.issueFromRefund(
          queryRunner.manager,
          order.customerId,
          refundAmount,
          savedRefund.id,
          userId,
        );
      }

      await queryRunner.commitTransaction();

      // Return refund with items loaded
      return (await this.refundRepository.findOne({
        where: { id: savedRefund.id },
        relations: ['items', 'user'],
      })) as Refund;
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  // `items.orderItem` is eager-loaded so callers can show WHAT was
  // refunded (name/sku/price), not just an orderItemId — Sally: "It's
  // not showing what has been refunded, can we have more information".
  async findByOrder(orderId: number): Promise<Refund[]> {
    return this.refundRepository.find({
      where: { orderId },
      relations: ['items', 'items.orderItem', 'user'],
      order: { createdAt: 'DESC' },
    });
  }
}
