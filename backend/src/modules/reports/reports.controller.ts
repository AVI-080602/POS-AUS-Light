import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  ParseIntPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ReportsService } from './reports.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles, RoleNames } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

type RangeParams = { from: string; to: string; channel?: string; groupBy?: string };

// Reports are commercially sensitive (costs, margins) — managers and
// admins only, except the endpoints that name sales staff below.
@ApiTags('reports')
@Controller('reports')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(RoleNames.ADMIN, RoleNames.MANAGER)
@ApiBearerAuth()
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  // ---- Sales summary by period, compared with the prior period
  // Sales staff can see Sales Summary, Sales by Item and Sales by Staff
  // (Sally, 16 Oct 2026) — without cost or margin, and the CSV buttons are
  // hidden for them on screen.
  @Get('summary')
  @Roles(RoleNames.ADMIN, RoleNames.MANAGER, RoleNames.SALES_STAFF)
  @ApiOperation({ summary: 'Sales summary for a range vs the previous range of equal length' })
  async summary(@Query() q: RangeParams & { tradeOnly?: string }) {
    return { success: true, data: await this.reportsService.salesSummary({ ...q, tradeOnly: q.tradeOnly === 'true' }) };
  }

  // ---- End of day (POS till)
  @Get('eod')
  @ApiOperation({ summary: 'Totals since the last day close (or start of today)' })
  async eod() {
    return { success: true, data: await this.reportsService.endOfDay() };
  }

  @Post('eod/close')
  @ApiOperation({ summary: 'Close the day: save the totals and start a new window' })
  async closeDay(@CurrentUser() user: any, @Body() body: { cashCounted?: unknown; notes?: unknown }) {
    const close = await this.reportsService.closeDay(user, body || {});
    return { success: true, message: 'Day closed', data: close };
  }

  @Get('eod/history')
  @ApiOperation({ summary: 'Past day closes' })
  async eodHistory(@Query('limit') limit?: string) {
    return { success: true, data: await this.reportsService.dayCloseHistory(Number(limit) || 60) };
  }

  @Get('eod/:id')
  @ApiOperation({ summary: 'One past day close, as it was closed' })
  async eodOne(@Param('id', ParseIntPipe) id: number) {
    return { success: true, data: await this.reportsService.dayClose(id) };
  }

  // ---- Profit & loss (gross profit)
  @Get('profit-loss')
  @ApiOperation({ summary: 'Sales, refunds, cost of goods and gross profit by day / month / year' })
  async profitLoss(@Query() q: RangeParams) {
    return { success: true, data: await this.reportsService.profitLoss(q) };
  }

  // ---- Clearance
  @Get('clearance')
  @ApiOperation({ summary: 'Clearance products sold, by period, plus top 10' })
  async clearance(@Query() q: RangeParams) {
    return { success: true, data: await this.reportsService.clearance(q) };
  }

  // ---- Sales by item / SKU
  @Get('items')
  @Roles(RoleNames.ADMIN, RoleNames.MANAGER, RoleNames.SALES_STAFF)
  @ApiOperation({ summary: 'Units, revenue and margin per product' })
  async items(
    @Query() q: RangeParams & { search?: string; tradeOnly?: string; limit?: string },
    @CurrentUser() user: any,
  ) {
    const data = await this.reportsService.salesByItem({ ...q, tradeOnly: q.tradeOnly === 'true', limit: Number(q.limit) || undefined });
    const role = user?.role?.name;
    if (role !== RoleNames.ADMIN && role !== RoleNames.MANAGER) {
      // Cost and margin stay with managers and admins.
      data.items = data.items.map((i: any) => ({ ...i, costIncGst: null, marginExGst: null, marginPct: null }));
    }
    return { success: true, data };
  }

  // ---- Products priced under cost or the minimum margin, at today's prices
  @Get('below-cost')
  @ApiOperation({ summary: 'Products priced below cost, or below cost + the minimum margin' })
  async belowCost() {
    return { success: true, data: await this.reportsService.belowCost() };
  }

  // ---- Trade: summary + best customers + top products, trade sales only
  @Get('trade')
  @ApiOperation({ summary: 'Trade-only sales summary, best trade customers and top products' })
  async trade(@Query() q: RangeParams) {
    const [summary, customers, products] = await Promise.all([
      this.reportsService.salesSummary({ ...q, tradeOnly: true }),
      this.reportsService.topCustomers({ ...q, tradeOnly: true, limit: 50 }),
      this.reportsService.salesByItem({ ...q, tradeOnly: true, limit: 25 }),
    ]);
    return { success: true, data: { summary, customers, products: products.items } };
  }

  // ---- Sales by employee
  @Get('staff')
  @Roles(RoleNames.ADMIN, RoleNames.MANAGER, RoleNames.SALES_STAFF)
  @ApiOperation({ summary: 'Revenue, transactions and average sale per staff member' })
  async staff(@Query() q: RangeParams) {
    return { success: true, data: await this.reportsService.salesByStaff(q) };
  }

  // ---- Top customers + purchase history
  @Get('customers')
  @ApiOperation({ summary: 'Top customers by spend in the range' })
  async customers(@Query() q: RangeParams & { limit?: string }) {
    return { success: true, data: await this.reportsService.topCustomers({ ...q, limit: Number(q.limit) || 100 }) };
  }

  @Get('customers/:id/history')
  @ApiOperation({ summary: "A customer's full purchase history" })
  async customerHistory(@Param('id', ParseIntPipe) id: number) {
    return { success: true, data: await this.reportsService.customerHistory(id) };
  }

  // ---- Backorders by supplier
  // Sales staff can view backorders (read-only) — Sally, 15 Oct 2026.
  @Get('backorders')
  @Roles(RoleNames.ADMIN, RoleNames.MANAGER, RoleNames.SALES_STAFF, RoleNames.PRICE_MATCH)
  @ApiOperation({ summary: 'Open backorder lines grouped by supplier' })
  async backorders() {
    return { success: true, data: await this.reportsService.backorders() };
  }

  @Get('backorders/next-po-number')
  @Roles(RoleNames.ADMIN, RoleNames.MANAGER, RoleNames.PRICE_MATCH)
  @ApiOperation({ summary: 'Next free PO number for a supplier' })
  async nextPoNumber(@Query('supplier') supplier?: string) {
    return { success: true, data: { poNumber: await this.reportsService.nextPoNumber(supplier || '') } };
  }

  @Post('backorders/purchase-orders')
  @Roles(RoleNames.ADMIN, RoleNames.MANAGER, RoleNames.PRICE_MATCH)
  @ApiOperation({ summary: 'Mark backorder lines as ordered from the supplier on a PO' })
  async markPurchaseOrder(
    @Body() body: { supplier?: string; lineIds?: number[]; poNumber?: string },
    @CurrentUser() user: any,
  ) {
    return { success: true, data: await this.reportsService.markPurchaseOrder(body, user) };
  }

  // Tick lines and Complete them (Sally, 11 Nov 2026) — the same people who
  // raise POs.
  @Post('backorders/complete')
  @Roles(RoleNames.ADMIN, RoleNames.MANAGER, RoleNames.PRICE_MATCH)
  @ApiOperation({ summary: 'Take ticked lines off back order, as the order screen does (no stock or money change)' })
  async completeBackorderLines(@Body() body: { lineIds?: number[] }, @CurrentUser() user: any) {
    return { success: true, data: await this.reportsService.completeBackorderLines(body || {}, user) };
  }

  // Supplier names for the pickers — every staff member (custom items at
  // the till need one).
  @Get('suppliers')
  @Roles(RoleNames.ADMIN, RoleNames.MANAGER, RoleNames.SALES_STAFF, RoleNames.PRICE_MATCH)
  @ApiOperation({ summary: 'Supplier / brand names, as Backorders groups them' })
  async supplierNames() {
    return { success: true, data: await this.reportsService.supplierNames() };
  }

  // Move a backorder line to another supplier — managers and admins.
  @Post('backorders/lines/:lineId/supplier')
  @Roles(RoleNames.ADMIN, RoleNames.MANAGER, RoleNames.PRICE_MATCH)
  @ApiOperation({ summary: 'Set the supplier a backorder line is ordered from' })
  async setBackorderSupplier(
    @Param('lineId', ParseIntPipe) lineId: number,
    @Body() body: { supplier?: string },
    @CurrentUser() user: any,
  ) {
    return { success: true, data: await this.reportsService.setBackorderSupplier(lineId, String(body?.supplier || ''), user) };
  }

  // Back to "not ordered" (Sally, 20 Oct 2026) — managers and admins, like
  // creating the PO.
  @Post('backorders/lines/:lineId/unorder')
  @Roles(RoleNames.ADMIN, RoleNames.MANAGER, RoleNames.PRICE_MATCH)
  @ApiOperation({ summary: 'Take a backorder line off its PO (back to not ordered)' })
  async unmarkPurchaseOrder(@Param('lineId', ParseIntPipe) lineId: number, @CurrentUser() user: any) {
    return { success: true, data: await this.reportsService.unmarkPurchaseOrder(lineId, user) };
  }

  // ---- Original reports (kept for the Discounts and Quotes tabs)
  @Get('sales')
  @ApiOperation({ summary: 'Get sales report' })
  async getSalesReport(
    @Query('dateFrom') dateFrom: string,
    @Query('dateTo') dateTo: string,
    @Query('groupBy') groupBy?: string,
  ) {
    const report = await this.reportsService.getSalesReport({ dateFrom, dateTo, groupBy: groupBy as any });
    return { success: true, data: report };
  }

  @Get('sales-by-user')
  @ApiOperation({ summary: 'Get sales by user report' })
  async getSalesByUser(@Query('dateFrom') dateFrom: string, @Query('dateTo') dateTo: string) {
    const report = await this.reportsService.getSalesByUser({ dateFrom, dateTo });
    return { success: true, data: report };
  }

  @Get('discounts')
  @ApiOperation({ summary: 'Get discount usage report' })
  async getDiscountReport(@Query('dateFrom') dateFrom: string, @Query('dateTo') dateTo: string) {
    const report = await this.reportsService.getDiscountReport({ dateFrom, dateTo });
    return { success: true, data: report };
  }

  @Get('quotes')
  @ApiOperation({ summary: 'Get quotes report' })
  async getQuotesReport(@Query('dateFrom') dateFrom: string, @Query('dateTo') dateTo: string) {
    const report = await this.reportsService.getQuotesReport({ dateFrom, dateTo });
    return { success: true, data: report };
  }
}
