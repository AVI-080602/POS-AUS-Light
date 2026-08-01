import {
  Injectable,
  BadRequestException,
  NotFoundException,
  OnModuleInit,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, EntityManager, IsNull, MoreThan } from 'typeorm';
import { StoreCredit } from './entities/store-credit.entity';
import {
  StoreCreditTransaction,
  StoreCreditTransactionType,
} from './entities/store-credit-transaction.entity';
import { Customer } from './entities/customer.entity';

// Each store credit lot (a refund issue or positive adjustment) is valid
// for 12 months from the day it was issued. After that, its remaining
// value is excluded from the customer's available balance.
const CREDIT_TTL_MS = 365 * 24 * 60 * 60 * 1000;

@Injectable()
export class StoreCreditService implements OnModuleInit {
  private readonly logger = new Logger(StoreCreditService.name);

  constructor(
    @InjectRepository(StoreCredit)
    private readonly storeCreditRepository: Repository<StoreCredit>,
    @InjectRepository(StoreCreditTransaction)
    private readonly txRepository: Repository<StoreCreditTransaction>,
    @InjectRepository(Customer)
    private readonly customerRepository: Repository<Customer>,
    private readonly dataSource: DataSource,
  ) {}

  // First-boot backfill after the expires_at column is added: every
  // pre-existing positive lot gets a 12-month grace from deploy day,
  // not from its original issue date, so nobody loses credit the day
  // this feature ships. New lots created after boot follow the normal
  // createdAt + 1y rule.
  async onModuleInit(): Promise<void> {
    const graceExpiresAt = new Date(Date.now() + CREDIT_TTL_MS);
    const missing = await this.txRepository.count({
      where: {
        expiresAt: IsNull(),
        amount: MoreThan(0),
      },
    });
    if (missing > 0) {
      this.logger.log(
        `Backfilling expiresAt on ${missing} legacy store-credit lots (grace until ${graceExpiresAt.toISOString()})`,
      );
      await this.txRepository
        .createQueryBuilder()
        .update()
        .set({ expiresAt: graceExpiresAt })
        .where('expires_at IS NULL AND amount > 0')
        .execute();
      // Refresh every customer's cached balance so the store_credits
      // table matches the new expiry-aware calculation.
      const rows: Array<{ customer_id: number }> = await this.txRepository
        .createQueryBuilder('t')
        .select('DISTINCT t.customer_id', 'customer_id')
        .getRawMany();
      for (const r of rows) {
        await this.recalcCache(Number(r.customer_id));
      }
    }
  }

  private round(n: number): number {
    return Math.round(n * 100) / 100;
  }

  // Expiry-aware balance: sum of unexpired positive lots minus every
  // redemption. Clamped to zero — a customer can't owe the store credit.
  private async computeAvailable(customerId: number): Promise<number> {
    const now = new Date();
    const positive = await this.txRepository
      .createQueryBuilder('t')
      .select('COALESCE(SUM(t.amount), 0)', 'total')
      .where('t.customer_id = :cid', { cid: customerId })
      .andWhere('t.amount > 0')
      .andWhere('(t.expires_at IS NULL OR t.expires_at > :now)', { now })
      .getRawOne();
    const negative = await this.txRepository
      .createQueryBuilder('t')
      .select('COALESCE(SUM(t.amount), 0)', 'total')
      .where('t.customer_id = :cid', { cid: customerId })
      .andWhere('t.amount < 0')
      .getRawOne();
    const gross = Number(positive?.total || 0) + Number(negative?.total || 0);
    return this.round(Math.max(0, gross));
  }

  private async recalcCache(customerId: number): Promise<number> {
    const available = await this.computeAvailable(customerId);
    await this.storeCreditRepository
      .createQueryBuilder()
      .update()
      .set({ balance: available })
      .where('customer_id = :cid', { cid: customerId })
      .execute();
    return available;
  }

  // Earliest expiry among a customer's remaining unexpired positive
  // lots. Returned as an ISO string so the UI can show "expires on X".
  // NULL when the customer has no unexpired lots.
  async getEarliestExpiry(customerId: number): Promise<string | null> {
    const now = new Date();
    const row = await this.txRepository
      .createQueryBuilder('t')
      .select('MIN(t.expires_at)', 'earliest')
      .where('t.customer_id = :cid', { cid: customerId })
      .andWhere('t.amount > 0')
      .andWhere('t.expires_at IS NOT NULL')
      .andWhere('t.expires_at > :now', { now })
      .getRawOne();
    return row?.earliest ? new Date(row.earliest).toISOString() : null;
  }

  /**
   * Fetch the balance row for a customer, creating it if it doesn't exist.
   * Always called inside an active transaction manager when possible.
   */
  private async getOrCreateBalance(
    manager: EntityManager,
    customerId: number,
  ): Promise<StoreCredit> {
    let balance = await manager.findOne(StoreCredit, {
      where: { customerId },
    });
    if (!balance) {
      // Verify customer exists
      const customer = await manager.findOne(Customer, {
        where: { id: customerId },
      });
      if (!customer) throw new NotFoundException('Customer not found');
      balance = manager.create(StoreCredit, {
        customerId,
        balance: 0,
      } as Partial<StoreCredit>);
      balance = await manager.save(balance);
    }
    return balance;
  }

  async getBalance(customerId: number): Promise<number> {
    // Always recompute against the ledger so any lots that expired
    // since the last write drop out of the reported balance without
    // waiting for a cron pass. Also refreshes the cached row.
    return this.recalcCache(customerId);
  }

  async getTransactions(customerId: number, limit = 50): Promise<StoreCreditTransaction[]> {
    return this.txRepository.find({
      where: { customerId },
      relations: ['user'],
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  /**
   * Issue store credit to a customer from a refund. Always adds to balance.
   * Called from RefundsService in the same DB transaction.
   */
  async issueFromRefund(
    manager: EntityManager,
    customerId: number,
    amount: number,
    refundId: number,
    userId: number,
  ): Promise<void> {
    if (amount <= 0) {
      throw new BadRequestException('Refund amount must be greater than 0');
    }
    const balance = await this.getOrCreateBalance(manager, customerId);
    const newBalance = this.round(Number(balance.balance) + amount);
    balance.balance = newBalance;
    await manager.save(balance);

    const now = new Date();
    const tx = manager.create(StoreCreditTransaction, {
      customerId,
      type: StoreCreditTransactionType.REFUND_ISSUE,
      amount: this.round(amount),
      balanceAfter: newBalance,
      relatedRefundId: refundId,
      userId,
      note: null,
      // Each new refund credit is a fresh 12-month lot.
      expiresAt: new Date(now.getTime() + CREDIT_TTL_MS),
    } as Partial<StoreCreditTransaction>);
    await manager.save(tx);
  }

  /**
   * Deduct store credit for an order. Called from OrdersService in the same
   * DB transaction. Throws if insufficient balance.
   */
  async redeemForOrder(
    manager: EntityManager,
    customerId: number,
    amount: number,
    orderId: number,
    userId: number,
  ): Promise<void> {
    if (amount <= 0) {
      throw new BadRequestException('Redemption amount must be greater than 0');
    }
    const balance = await this.getOrCreateBalance(manager, customerId);
    const current = Number(balance.balance);
    if (current < amount - 0.01) {
      throw new BadRequestException(
        `Insufficient store credit: $${current.toFixed(2)} available, $${amount.toFixed(2)} requested`,
      );
    }
    const newBalance = this.round(current - amount);
    balance.balance = newBalance;
    await manager.save(balance);

    const tx = manager.create(StoreCreditTransaction, {
      customerId,
      type: StoreCreditTransactionType.REDEMPTION,
      amount: -this.round(amount),
      balanceAfter: newBalance,
      relatedOrderId: orderId,
      userId,
      note: null,
    } as Partial<StoreCreditTransaction>);
    await manager.save(tx);
  }

  /**
   * Pre-validate that the customer has enough balance before saving the order.
   * Doesn't mutate state — used to fail fast before building the order.
   */
  async assertSufficientBalance(customerId: number, amount: number): Promise<void> {
    const current = await this.getBalance(customerId);
    if (current < amount - 0.01) {
      throw new BadRequestException(
        `Insufficient store credit: $${current.toFixed(2)} available (after expiry), $${amount.toFixed(2)} requested`,
      );
    }
  }

  /**
   * Manual admin adjustment. Can be positive (add credit) or negative
   * (claw back). The only path that permits a negative balance.
   */
  async manualAdjust(
    customerId: number,
    amount: number,
    userId: number,
    note: string,
  ): Promise<{ balance: number; transaction: StoreCreditTransaction }> {
    if (!note || !note.trim()) {
      throw new BadRequestException('A note is required for manual adjustments');
    }
    if (amount === 0) {
      throw new BadRequestException('Adjustment amount cannot be 0');
    }

    return this.dataSource.transaction(async (manager) => {
      const balance = await this.getOrCreateBalance(manager, customerId);
      const newBalance = this.round(Number(balance.balance) + amount);
      balance.balance = newBalance;
      await manager.save(balance);

      const now = new Date();
      const tx = manager.create(StoreCreditTransaction, {
        customerId,
        type: StoreCreditTransactionType.MANUAL_ADJUSTMENT,
        amount: this.round(amount),
        balanceAfter: newBalance,
        userId,
        note: note.trim(),
        // Positive adjustments count as new 12-month lots; negative
        // (clawbacks) don't expire.
        expiresAt: amount > 0 ? new Date(now.getTime() + CREDIT_TTL_MS) : null,
      } as Partial<StoreCreditTransaction>);
      const savedTx = await manager.save(tx);

      return { balance: newBalance, transaction: savedTx };
    });
  }

  /**
   * Pay leftover store credit out to the customer in cash.
   *
   * The exchange case Sally hit: a $96 item comes back, the customer
   * only wants a $7.96 replacement, and the $88.04 difference has to
   * leave the till as cash rather than sit on the account as credit.
   * The refund already issued the credit and the exchange order spent
   * part of it, so this drains whatever is left.
   *
   * Recorded as a negative MANUAL_ADJUSTMENT tagged [CASH PAID OUT] so
   * it shows in the credit history and reconciles against the till.
   */
  async cashOut(
    customerId: number,
    amount: number,
    userId: number,
    note?: string,
  ): Promise<{ balance: number; transaction: StoreCreditTransaction }> {
    const paidOut = this.round(Number(amount));
    if (!Number.isFinite(paidOut) || paidOut <= 0) {
      throw new BadRequestException('Cash-out amount must be greater than 0');
    }
    // Never let a cash-out overdraw the account — unlike manualAdjust,
    // this one hands real money over the counter.
    await this.assertSufficientBalance(customerId, paidOut);

    return this.dataSource.transaction(async (manager) => {
      const balance = await this.getOrCreateBalance(manager, customerId);
      const newBalance = this.round(Number(balance.balance) - paidOut);
      balance.balance = newBalance;
      await manager.save(balance);

      const tx = manager.create(StoreCreditTransaction, {
        customerId,
        type: StoreCreditTransactionType.MANUAL_ADJUSTMENT,
        amount: -paidOut,
        balanceAfter: newBalance,
        userId,
        note: `[CASH PAID OUT] ${note?.trim() || 'Refund of exchange difference'}`,
        expiresAt: null,
      } as Partial<StoreCreditTransaction>);
      const savedTx = await manager.save(tx);

      return { balance: newBalance, transaction: savedTx };
    });
  }
}
