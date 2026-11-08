import {
  Controller,
  Get,
  Post,
  Patch,
  BadRequestException,
  Body,
  Param,
  Query,
  UseGuards,
  ParseIntPipe,
  NotFoundException,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { OrdersService } from './orders.service';
import { RefundsService, CreateRefundDto } from './refunds.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles, RoleNames } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@ApiTags('orders')
@Controller('orders')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class OrdersController {
  constructor(
    private readonly ordersService: OrdersService,
    private readonly refundsService: RefundsService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List orders' })
  async findAll(
    @Query('status') status?: string,
    @Query('source') source?: string,
    @Query('type') type?: string,
    @Query('search') search?: string,
    @Query('userId') userId?: number,
    @Query('customerId') customerId?: number,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @CurrentUser() user?: any,
  ) {
    const { orders, total } = await this.ordersService.findAll({
      status: status as any,
      source: source as any,
      orderType: type as any,
      search,
      userId,
      customerId,
      dateFrom: dateFrom ? new Date(dateFrom) : undefined,
      dateTo: dateTo ? new Date(dateTo) : undefined,
      page,
      limit,
      // Voided sales are for admins only (Sally, 7 Nov 2026).
      hideVoided: user?.role?.name !== RoleNames.ADMIN,
    });

    // Batch-detect which orders on this page were exchanged (i.e. have
    // at least one replacement order pointing back at them). One extra
    // DB round-trip per page — the list badge then flips "REFUNDED"
    // -> "EXCHANGED" without a per-row query.
    const exchangedIds = new Set<number>(
      orders.length > 0
        ? await this.ordersService
            .findExchangedOriginals(orders.map((o) => o.id))
        : [],
    );

    return {
      success: true,
      data: {
        orders: orders.map((o) => ({
          id: o.id,
          orderNumber: o.orderNumber,
          status: o.status,
          paymentStatus: o.paymentStatus,
          grandTotal: parseFloat(o.grandTotal.toString()),
          customer: o.customer
            ? {
                id: o.customer.id,
                firstName: o.customer.firstName,
                lastName: o.customer.lastName,
                isTrade: o.customer.isTrade,
              }
            : null,
          customerNameSnapshot: o.customerNameSnapshot,
          hasExchange: exchangedIds.has(o.id),
          user: {
            id: o.user.id,
            firstName: o.user.firstName,
            lastName: o.user.lastName,
          },
          itemCount: o.items.length,
          createdAt: o.createdAt,
          source: o.source,
          voidedAt: o.voidedAt || null,
          legacyFile: o.legacyFile || null,
          orderType: o.orderType,
          laybyExpiresAt: o.laybyExpiresAt,
          hasBackorderItems: o.items.some((i) => i.isBackorder),
          // Per-line status counts for the list's Items column (Sally,
          // 10 Sep: "multiple statuses must be displayed in the order
          // summary").
          backorderOpenCount: o.items.filter((i) => i.isBackorder && !i.backorderFulfilledAt).length,
          backorderFulfilledCount: o.items.filter((i) => i.isBackorder && !!i.backorderFulfilledAt).length,
          laybyHeldCount: o.items.filter((i) => i.isLaybyHeld).length,
          magentoIncrementId: o.magentoIncrementId,
          magentoOrderId: o.magentoOrderId,
          syncStatus: o.syncStatus,
          syncError: o.syncError,
          syncAttempts: o.syncAttempts,
        })),
        pagination: {
          page: page || 1,
          limit: limit || 20,
          total,
          totalPages: Math.ceil(total / (limit || 20)),
        },
      },
    };
  }

  // The exact invoice the customer received, for orders imported from
  // the old Excel system. Files live outside the web root; the name is
  // taken from the order row, never from the request, so nothing else
  // on the disk is reachable.
  @Get(':id/original-invoice')
  @ApiOperation({ summary: 'Download the original legacy invoice file for an imported order' })
  async originalInvoice(@Param('id', ParseIntPipe) id: number, @Res() res: Response) {
    const order = await this.ordersService.findById(id);
    if (!order || !order.legacyFile) {
      throw new NotFoundException('This order has no original invoice file');
    }
    const dir = process.env.LEGACY_INVOICES_DIR || '/opt/pos-aus-light/legacy-invoices';
    const file = path.join(dir, path.basename(order.legacyFile));
    if (!fs.existsSync(file)) {
      throw new NotFoundException('Original invoice file is missing on the server');
    }
    const ext = path.extname(file).toLowerCase();
    const type =
      ext === '.xls'
        ? 'application/vnd.ms-excel'
        : ext === '.xlsm'
          ? 'application/vnd.ms-excel.sheet.macroEnabled.12'
          : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    res.setHeader('Content-Type', type);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${order.orderNumber}-original${ext}"`,
    );
    fs.createReadStream(file).pipe(res);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get order by ID' })
  async findOne(@Param('id', ParseIntPipe) id: number, @CurrentUser() user?: any) {
    const order = await this.ordersService.findById(id);
    if (!order || (order.voidedAt && user?.role?.name !== RoleNames.ADMIN)) {
      return {
        success: false,
        error: { code: 'NOT_FOUND', message: 'Order not found' },
      };
    }

    const exchange = await this.ordersService.getExchangeLinks(order);
    // Timeline events (item edits etc.) ride along so the Order History
    // section can show every action without extra round-trips.
    const events = await this.ordersService.getEvents(id);
    // The "Apply Further Discount" part of the discount — the invoice and
    // Edit Items show it as its own line.
    const cartDiscount = await this.ordersService.getCartDiscount(order, order.items || []);

    return {
      success: true,
      data: { order: { ...order, ...exchange, events, cartDiscount } },
    };
  }

  @Post()
  @ApiOperation({ summary: 'Create new order' })
  async create(@Body() createDto: any, @CurrentUser() user: any) {
    const userRole = {
      id: user.role.id,
      name: user.role.name,
      maxDiscountPercent: parseFloat(user.role.maxDiscountPercent),
      canStackDiscounts: user.role.canStackDiscounts,
    };

    const order = await this.ordersService.create(createDto, user.id, userRole);

    return {
      success: true,
      data: {
        order: {
          id: order.id,
          orderNumber: order.orderNumber,
          status: order.status,
          paymentStatus: order.paymentStatus,
          grandTotal: parseFloat(order.grandTotal.toString()),
          syncStatus: order.syncStatus,
          createdAt: order.createdAt,
        },
        receipt: {
          url: `/receipts/${order.orderNumber}.pdf`,
        },
      },
    };
  }

  @Patch(':id/customer')
  @ApiOperation({
    summary:
      'Link a customer to an existing order (e.g. a walk-in) so store credit can be issued on refund. Any signed-in staff can link — no role restriction.',
  })
  async linkCustomer(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { customerId: number },
    @CurrentUser() user: any,
  ) {
    await this.ordersService.assertEditable(id);
    if (!body?.customerId) {
      return {
        success: false,
        error: { code: 'BAD_REQUEST', message: 'customerId is required' },
      };
    }
    const order = await this.ordersService.linkCustomer(id, Number(body.customerId), user?.id);
    return {
      success: true,
      data: {
        order: {
          id: order.id,
          orderNumber: order.orderNumber,
          customerId: order.customerId,
          customer: order.customer
            ? {
                id: order.customer.id,
                firstName: order.customer.firstName,
                lastName: order.customer.lastName,
              }
            : null,
        },
      },
    };
  }

  @Patch(':id/notes')
  @ApiOperation({
    summary:
      'Update order notes — customer-facing `notes` (printed on the invoice) and/or staff-only `internalNotes`',
  })
  async updateNotes(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { notes?: string | null; internalNotes?: string | null },
  ) {
    // The staff-only internal note stays editable on website orders; the
    // customer-facing note prints on the invoice, so it doesn't.
    if (body?.notes !== undefined) await this.ordersService.assertEditable(id);
    const order = await this.ordersService.updateNotes(
      id,
      body?.notes,
      body?.internalNotes,
    );
    return {
      success: true,
      data: {
        order: {
          id: order.id,
          notes: order.notes,
          internalNotes: order.internalNotes,
        },
      },
    };
  }

  @Patch(':id/items')
  @ApiOperation({
    summary:
      "Replace the line items on an open order (backorder/layby/pending) or a completed POS sale (it then owes any difference). Blocked once refunded/cancelled.",
  })
  async updateItems(
    @Param('id', ParseIntPipe) id: number,
    @Body()
    body: {
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
        fromItemId?: number;
      }>;
    },
    @CurrentUser() user: any,
  ) {
    await this.ordersService.assertEditable(id);
    const userRole = {
      id: user.role.id,
      name: user.role.name,
      maxDiscountPercent: parseFloat(user.role.maxDiscountPercent),
      canStackDiscounts: user.role.canStackDiscounts,
    };
    const order = await this.ordersService.updateItems(
      id,
      user.id,
      body?.items || [],
      userRole,
    );
    return { success: true, data: { order } };
  }

  @Patch(':id/payments/:paymentId')
  @ApiOperation({
    summary:
      "Correct a previously-recorded payment amount on an open order (cashier typed the wrong amount). Doesn't refund — use /refund for actual money back.",
  })
  async adjustPayment(
    @Param('id', ParseIntPipe) id: number,
    @Param('paymentId', ParseIntPipe) paymentId: number,
    @Body() body: { amount: number },
    @CurrentUser() user: any,
  ) {
    await this.ordersService.assertEditable(id);
    const order = await this.ordersService.adjustPayment(
      id,
      paymentId,
      Number(body?.amount),
      user.id,
    );
    return {
      success: true,
      data: { order: { id: order.id, grandTotal: order.grandTotal, paymentStatus: order.paymentStatus } },
    };
  }

  // Fix how a payment was taken (EFTPOS -> cash etc.) without refunding
  // and redoing the sale (Sally, 13 Oct 2026). Managers and admins.
  @Patch(':id/payments/:paymentId/method')
  @UseGuards(RolesGuard)
  @Roles(RoleNames.ADMIN, RoleNames.MANAGER)
  @ApiOperation({ summary: 'Change the method of a recorded payment (amount unchanged)' })
  async changePaymentMethod(
    @Param('id', ParseIntPipe) id: number,
    @Param('paymentId', ParseIntPipe) paymentId: number,
    @Body() body: { method: string; reference?: string },
    @CurrentUser() user: any,
  ) {
    await this.ordersService.assertEditable(id);
    const order = await this.ordersService.changePaymentMethod(
      id,
      paymentId,
      String(body?.method || ''),
      body?.reference,
      user.id,
    );
    return { success: true, data: { order: { id: order.id } } };
  }

  @Post(':id/refund')
  @UseGuards(RolesGuard)
  @Roles(RoleNames.ADMIN, RoleNames.MANAGER, RoleNames.SALES_STAFF)
  @ApiOperation({ summary: 'Refund selected items on an order (partial or full)' })
  async refund(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateRefundDto,
    @CurrentUser() user: any,
  ) {
    await this.ordersService.assertEditable(id);
    const refund = await this.refundsService.create(id, user.id, dto);
    return {
      success: true,
      data: {
        refund: {
          id: refund.id,
          orderId: refund.orderId,
          reason: refund.reason,
          reasonText: refund.reasonText,
          refundAmount: parseFloat(refund.refundAmount.toString()),
          isFullRefund: refund.isFullRefund,
          createdAt: refund.createdAt,
          user: refund.user
            ? {
                id: refund.user.id,
                firstName: refund.user.firstName,
                lastName: refund.user.lastName,
              }
            : null,
          items: refund.items.map((ri) => ({
            id: ri.id,
            orderItemId: ri.orderItemId,
            quantity: ri.quantity,
            amount: parseFloat(ri.amount.toString()),
            restock: ri.restock,
          })),
        },
      },
    };
  }

  @Post(':id/layby/payment')
  @ApiOperation({
    summary: 'Record a payment against an active layby. Completes the layby once fully paid.',
  })
  async takeLaybyPayment(
    @Param('id', ParseIntPipe) id: number,
    @Body()
    body: {
      amount: number;
      method: string;
      reference?: string;
      amountTendered?: number;
    },
    @CurrentUser() user: any,
  ) {
    await this.ordersService.assertEditable(id);
    const order = await this.ordersService.takeLaybyPayment(id, user.id, body);
    const balance = await this.ordersService.getLaybyBalance(id);
    return {
      success: true,
      data: {
        order: {
          id: order.id,
          orderNumber: order.orderNumber,
          status: order.status,
          paymentStatus: order.paymentStatus,
          grandTotal: parseFloat(order.grandTotal.toString()),
        },
        balance,
      },
    };
  }

  @Post(':id/layby/cancel')
  @UseGuards(RolesGuard)
  @Roles(RoleNames.ADMIN, RoleNames.MANAGER)
  @ApiOperation({
    summary: 'Cancel an active or expired layby and optionally refund paid amounts as store credit',
  })
  async cancelLayby(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { reason?: string; refundAsStoreCredit?: boolean },
    @CurrentUser() user: any,
  ) {
    await this.ordersService.assertEditable(id);
    const order = await this.ordersService.cancelLayby(id, user.id, {
      reason: body?.reason,
      refundAsStoreCredit: !!body?.refundAsStoreCredit,
    });
    return {
      success: true,
      data: {
        order: {
          id: order.id,
          orderNumber: order.orderNumber,
          status: order.status,
        },
      },
    };
  }

  @Get(':id/layby/balance')
  @ApiOperation({ summary: 'Current balance due on a layby' })
  async getLaybyBalance(@Param('id', ParseIntPipe) id: number) {
    const balance = await this.ordersService.getLaybyBalance(id);
    return { success: true, data: balance };
  }

  @Post('laybys/expire')
  @UseGuards(RolesGuard)
  @Roles(RoleNames.ADMIN, RoleNames.MANAGER)
  @ApiOperation({
    summary: 'Mark laybys past their expiry date as expired. Safe to call repeatedly.',
  })
  async expireLaybys() {
    const count = await this.ordersService.expireLaybys();
    return { success: true, data: { expired: count } };
  }

  @Patch(':id/items/:itemId/status')
  @ApiOperation({
    summary:
      "Set one line item's status (backorder / layby / paid) from the order screen. Logs a timeline event.",
  })
  async setItemStatus(
    @Param('id', ParseIntPipe) id: number,
    @Param('itemId', ParseIntPipe) itemId: number,
    @Body() body: { status?: string },
    @CurrentUser() user: any,
  ) {
    const status = String(body?.status || '').toLowerCase();
    if (status !== 'backorder' && status !== 'layby' && status !== 'paid') {
      throw new BadRequestException('status must be backorder, layby or paid');
    }
    await this.ordersService.assertEditable(id);
    const order = await this.ordersService.setItemStatus(id, itemId, status, user.id);
    return { success: true, data: { order } };
  }

  // Customer takes part of a back order / lay-by (Sally, 23 Oct 2026).
  @Post(':id/collect')
  @ApiOperation({
    summary: 'Customer collects some of the back-order / lay-by items — splits those lines, total unchanged',
  })
  async collectItems(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { lines?: Array<{ itemId: number; qty: number }> },
    @CurrentUser() user: any,
  ) {
    await this.ordersService.assertEditable(id);
    const order = await this.ordersService.collectItems(id, body?.lines || [], user.id);
    return { success: true, data: { order } };
  }

  // Void a sale put through by mistake (duplicates) — admins only (Sally,
  // 17 Oct 2026). Not a refund: the sale drops out of the reports.
  @Post(':id/void')
  @UseGuards(RolesGuard)
  @Roles(RoleNames.ADMIN)
  @ApiOperation({ summary: 'Void a sale (admin) — cancelled, out of the reports, stock back' })
  async voidOrder(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { reason?: string },
    @CurrentUser() user: any,
  ) {
    const order = await this.ordersService.voidOrder(id, String(body?.reason || ''), user.id);
    return { success: true, data: { order: { id: order.id, status: order.status, voidedAt: order.voidedAt } } };
  }

  // Website orders: put a line (or part of it) on back order, or mark that
  // back order complete (Sally, 16 Oct 2026).
  @Patch(':id/items/:itemId/website-status')
  @ApiOperation({ summary: 'Back Order / Complete on a website order line (no stock or money change)' })
  async setWebsiteLineStatus(
    @Param('id', ParseIntPipe) id: number,
    @Param('itemId', ParseIntPipe) itemId: number,
    @Body() body: { status?: string; qty?: number },
    @CurrentUser() user: any,
  ) {
    const status = String(body?.status || '').toLowerCase();
    if (status !== 'backorder' && status !== 'complete') {
      throw new BadRequestException('status must be backorder or complete');
    }
    const order = await this.ordersService.setWebsiteLineStatus(
      id,
      itemId,
      status,
      body?.qty != null ? Number(body.qty) : undefined,
      user.id,
    );
    return { success: true, data: { order } };
  }

  @Post(':id/backorder/fulfill')
  @UseGuards(RolesGuard)
  @Roles(RoleNames.ADMIN, RoleNames.MANAGER)
  @ApiOperation({
    summary: 'Mark backorder items as received. Completes the order when all lines are fulfilled.',
  })
  async fulfillBackorder(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { itemIds: number[] },
  ) {
    await this.ordersService.assertEditable(id);
    const order = await this.ordersService.fulfillBackorderItems(
      id,
      body?.itemIds || [],
    );
    return {
      success: true,
      data: {
        order: {
          id: order.id,
          orderNumber: order.orderNumber,
          status: order.status,
        },
      },
    };
  }

  @Get(':id/refunds')
  @ApiOperation({ summary: 'List refunds for an order' })
  async listRefunds(@Param('id', ParseIntPipe) id: number) {
    const refunds = await this.refundsService.findByOrder(id);
    return {
      success: true,
      data: {
        refunds: refunds.map((r) => ({
          id: r.id,
          reason: r.reason,
          reasonText: r.reasonText,
          refundAmount: parseFloat(r.refundAmount.toString()),
          isFullRefund: r.isFullRefund,
          createdAt: r.createdAt,
          user: r.user
            ? {
                id: r.user.id,
                firstName: r.user.firstName,
                lastName: r.user.lastName,
              }
            : null,
          items: r.items.map((ri) => ({
            id: ri.id,
            orderItemId: ri.orderItemId,
            quantity: ri.quantity,
            amount: parseFloat(ri.amount.toString()),
            restock: ri.restock,
            // Product identity so the refund history reads like a
            // receipt instead of a list of row ids.
            sku: ri.orderItem?.sku ?? null,
            name: ri.orderItem?.name ?? null,
            unitPrice: ri.orderItem
              ? parseFloat(ri.orderItem.unitPrice.toString())
              : null,
            originalQuantity: ri.orderItem?.quantity ?? null,
          })),
        })),
      },
    };
  }
}
