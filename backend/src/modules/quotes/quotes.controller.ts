import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
  ParseIntPipe,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { QuotesService, CreateQuoteDto, UpdateQuoteDto } from './quotes.service';
import { TradeDiscountsService } from '../products/trade-discounts.service';
import { OrdersService } from '../orders/orders.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { QuoteStatus } from './entities/quote.entity';
import { Product } from '../products/entities/product.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';

@ApiTags('quotes')
@Controller('quotes')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class QuotesController {
  constructor(
    private readonly quotesService: QuotesService,
    private readonly ordersService: OrdersService,
    private readonly tradeDiscounts: TradeDiscountsService,
    @InjectRepository(Product)
    private readonly productRepository: Repository<Product>,
  ) {}

  // Preview-only: returns the auto trade discount the server would
  // apply to each productId on save. Used by the Quotes create form
  // (and POS cart) to show the discount in real time.
  @Post('trade-discount-preview')
  @ApiOperation({
    summary: 'Compute the trade auto-discount for a list of product IDs',
  })
  async tradeDiscountPreview(
    @Body() body: { productIds: number[] },
  ) {
    const ids = Array.isArray(body?.productIds)
      ? body.productIds.filter((n) => Number.isFinite(n) && n > 0)
      : [];
    if (ids.length === 0) {
      return { success: true, data: { discounts: {} } };
    }
    const products = await this.productRepository.find({
      where: { id: In(ids) },
      relations: ['categories'],
    });
    const discounts: Record<
      number,
      { percent: number; label: string | null; baseOnSpecialPrice: boolean }
    > = {};
    for (const p of products) {
      discounts[p.id] = await this.tradeDiscounts.getAutoDiscount(p);
    }
    return { success: true, data: { discounts } };
  }

  @Post()
  @ApiOperation({ summary: 'Create a new quote' })
  async create(@Body() dto: CreateQuoteDto, @CurrentUser() user: any) {
    const quote = await this.quotesService.create(dto, user.id);
    return {
      success: true,
      data: { quote },
    };
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update an open quote' })
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateQuoteDto,
    @CurrentUser() user: any,
  ) {
    const quote = await this.quotesService.update(id, dto, user.id);
    return {
      success: true,
      data: { quote },
    };
  }

  @Post(':id/cancel')
  @ApiOperation({ summary: 'Cancel an open quote' })
  async cancel(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: any,
  ) {
    const quote = await this.quotesService.cancel(id, user.id);
    return {
      success: true,
      data: { quote },
    };
  }

  @Get(':id/convert-check')
  @ApiOperation({
    summary: 'Check whether a quote can be converted (stock + expiry)',
  })
  async convertCheck(@Param('id', ParseIntPipe) id: number) {
    const { quote, blockers, expiredWithinGrace } =
      await this.quotesService.validateConvert(id);
    const priceRows = await this.quotesService.computeConversionPrices(quote);
    // Compute the amount the resulting order will require, using the
    // SAME gross / GST-inclusive convention the orders service uses.
    // Old quotes have a wrong stored grandTotal (legacy +10%-on-top
    // calc), so the frontend can't trust quote.grandTotal as the
    // payment amount — it has to use this value instead.
    let payableAmount = 0;
    for (const r of priceRows) {
      const lineSubtotal = r.effectiveUnitPrice * r.quantity;
      const discount = lineSubtotal * (r.discountPercent / 100);
      payableAmount += lineSubtotal - discount;
    }
    payableAmount = Math.round(payableAmount * 100) / 100;
    return {
      success: true,
      data: {
        canConvert: !blockers.outOfStock && !blockers.expiredPastGrace,
        expiredWithinGrace,
        blockers,
        prices: priceRows,
        payableAmount,
      },
    };
  }

  @Post(':id/convert')
  @ApiOperation({ summary: 'Convert a quote to an order' })
  async convert(
    @Param('id', ParseIntPipe) id: number,
    @Body()
    body: {
      payments: Array<{
        method: string;
        amount: number;
        reference?: string;
        amountTendered?: number;
      }>;
      customerId?: number;
      notes?: string;
      allowBackorder?: boolean;
      // How the converted order should be fulfilled. 'full' (default)
      // is paid-and-taken; 'layby' holds the goods against a deposit;
      // 'backorder' flags every line as coming from the supplier.
      // Sally: "once the quote has been converted ... need options to
      // add as layby or backorder".
      fulfilment?: 'full' | 'layby' | 'backorder';
    },
    @CurrentUser() user: any,
  ) {
    const fulfilment = body.fulfilment || 'full';
    // A layby/backorder conversion is itself a deliberate "don't take
    // the stock now" decision, so it implies the stock override.
    const allowBackorder = !!body.allowBackorder || fulfilment !== 'full';
    if (allowBackorder && user.role.name !== 'admin' && user.role.name !== 'manager') {
      throw new ForbiddenException(
        'Only managers or admins may override stock checks',
      );
    }

    const { quote, blockers } = await this.quotesService.validateConvert(
      id,
      allowBackorder,
    );

    if (blockers.expiredPastGrace) {
      throw new BadRequestException(
        `Quote has expired beyond the ${blockers.expiredPastGrace.graceDays}-day grace period. Create a new quote.`,
      );
    }
    if (blockers.outOfStock) {
      throw new BadRequestException({
        message: 'Some items are out of stock',
        outOfStock: blockers.outOfStock,
      });
    }

    // Use the quoted price unless current price is lower
    const priceRows = await this.quotesService.computeConversionPrices(quote);

    // Build CreateOrderDto from quote
    const userRole = {
      id: user.role.id,
      name: user.role.name,
      maxDiscountPercent: parseFloat(user.role.maxDiscountPercent),
      canStackDiscounts: user.role.canStackDiscounts,
    };

    // Only include items with a real productId (skip custom/legacy quote items that can't map back to a product)
    const items = priceRows
      .filter((r) => r.productId != null)
      .map((r) => ({
        productId: r.productId as number,
        quantity: r.quantity,
        unitPriceOverride: r.effectiveUnitPrice,
        discountPercent: r.discountPercent,
      }));

    if (items.length === 0) {
      throw new BadRequestException(
        'No convertible items on this quote (all items lack a product reference)',
      );
    }

    const order = await this.ordersService.create(
      {
        customerId: body.customerId ?? quote.customerId ?? undefined,
        // Quote prices are locked in at quote-creation time (especially
        // for trade quotes where the cashier may have negotiated a
        // custom price). Pass them through and tell the orders service
        // to trust them, otherwise the order is rebuilt at the current
        // catalogue price and the payment doesn't match.
        trustItemUnitPrices: true,
        items: items.map((i) => ({
          productId: i.productId,
          quantity: i.quantity,
          discountPercent: i.discountPercent,
          unitPrice: i.unitPriceOverride,
          // Layby holds the whole line on the shelf; backorder flags the
          // whole line as coming from the supplier. Paid-in-full does
          // neither and the goods walk out today.
          isLaybyHeld: fulfilment === 'layby',
          laybyHeldQty: fulfilment === 'layby' ? i.quantity : undefined,
          isBackorder: fulfilment === 'backorder',
          backorderQty: fulfilment === 'backorder' ? i.quantity : undefined,
        })),
        payments: body.payments,
        notes: body.notes || `Converted from quote ${quote.quoteNumber}`,
      } as any,
      user.id,
      userRole,
    );

    await this.quotesService.markConverted(quote.id, order.id);

    return {
      success: true,
      data: {
        order: {
          id: order.id,
          orderNumber: order.orderNumber,
          grandTotal: parseFloat(order.grandTotal.toString()),
          status: order.status,
        },
        quoteId: quote.id,
      },
    };
  }

  @Get()
  @ApiOperation({ summary: 'List quotes' })
  async findAll(
    @Query('status') status?: string,
    @Query('customerId') customerId?: number,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    const { quotes, total } = await this.quotesService.findAll({
      status: status as QuoteStatus,
      customerId,
      page,
      limit,
    });

    return {
      success: true,
      data: {
        quotes: quotes.map((q) => ({
          id: q.id,
          quoteNumber: q.quoteNumber,
          status: q.status,
          buyerType: q.buyerType,
          grandTotal: parseFloat(q.grandTotal.toString()),
          customer: q.customer
            ? {
                id: q.customer.id,
                firstName: q.customer.firstName,
                lastName: q.customer.lastName,
              }
            : null,
          user: {
            id: q.user.id,
            firstName: q.user.firstName,
            lastName: q.user.lastName,
          },
          itemCount: q.items?.length || 0,
          expiresAt: q.expiresAt,
          createdAt: q.createdAt,
          convertedOrderId: q.convertedOrderId,
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

  @Get(':id')
  @ApiOperation({ summary: 'Get quote by ID' })
  async findOne(@Param('id', ParseIntPipe) id: number) {
    const quote = await this.quotesService.findById(id);
    if (!quote) {
      return {
        success: false,
        error: { code: 'NOT_FOUND', message: 'Quote not found' },
      };
    }

    return {
      success: true,
      data: { quote },
    };
  }
}
