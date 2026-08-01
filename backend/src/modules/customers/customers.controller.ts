import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Param,
  Query,
  UseGuards,
  ParseIntPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { CustomersService } from './customers.service';
import { StoreCreditService } from './store-credit.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles, RoleNames } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@ApiTags('customers')
@Controller('customers')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class CustomersController {
  constructor(
    private readonly customersService: CustomersService,
    private readonly storeCreditService: StoreCreditService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Search customers' })
  async findAll(
    @Query('search') search?: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    const { customers, total } = await this.customersService.findAll({
      search,
      page,
      limit,
    });

    return {
      success: true,
      data: {
        customers,
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
  @ApiOperation({ summary: 'Get customer by ID' })
  async findOne(@Param('id', ParseIntPipe) id: number) {
    const customer = await this.customersService.findById(id);
    if (!customer) {
      return {
        success: false,
        error: { code: 'NOT_FOUND', message: 'Customer not found' },
      };
    }

    return {
      success: true,
      data: { customer },
    };
  }

  @Get(':id/stats')
  @ApiOperation({ summary: 'Get customer aggregate stats (spend, orders, quotes)' })
  async getStats(@Param('id', ParseIntPipe) id: number) {
    const stats = await this.customersService.getStats(id);
    return {
      success: true,
      data: { stats },
    };
  }

  @Get(':id/store-credit')
  @ApiOperation({ summary: 'Get store credit balance + recent transactions' })
  async getStoreCredit(@Param('id', ParseIntPipe) id: number) {
    const [balance, transactions, earliestExpiry] = await Promise.all([
      this.storeCreditService.getBalance(id),
      this.storeCreditService.getTransactions(id, 50),
      this.storeCreditService.getEarliestExpiry(id),
    ]);
    return {
      success: true,
      data: {
        balance,
        earliestExpiry,
        transactions: transactions.map((t) => ({
          id: t.id,
          type: t.type,
          amount: parseFloat(t.amount.toString()),
          balanceAfter: parseFloat(t.balanceAfter.toString()),
          expiresAt: t.expiresAt,
          relatedOrderId: t.relatedOrderId,
          relatedRefundId: t.relatedRefundId,
          note: t.note,
          createdAt: t.createdAt,
          user: t.user
            ? {
                id: t.user.id,
                firstName: t.user.firstName,
                lastName: t.user.lastName,
              }
            : null,
        })),
      },
    };
  }

  @Post(':id/store-credit/cash-out')
  @ApiOperation({
    summary:
      'Pay leftover store credit out to the customer as cash. Used when an exchange is cheaper than the returned item and the difference has to go back over the counter.',
  })
  async cashOutStoreCredit(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { amount: number; note?: string },
    @CurrentUser() user: any,
  ) {
    const result = await this.storeCreditService.cashOut(
      id,
      Number(body.amount),
      user.id,
      body.note,
    );
    return {
      success: true,
      data: {
        balance: result.balance,
        paidOut: Math.abs(
          parseFloat(result.transaction.amount.toString()),
        ),
        transaction: {
          id: result.transaction.id,
          type: result.transaction.type,
          amount: parseFloat(result.transaction.amount.toString()),
          balanceAfter: parseFloat(result.transaction.balanceAfter.toString()),
          note: result.transaction.note,
          createdAt: result.transaction.createdAt,
        },
      },
    };
  }

  @Post(':id/store-credit/adjust')
  @ApiOperation({
    summary:
      "Manually adjust a customer store credit balance. Any signed-in staff can adjust — every adjustment requires a note and is logged with the staff member's name.",
  })
  async adjustStoreCredit(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { amount: number; note: string },
    @CurrentUser() user: any,
  ) {
    const result = await this.storeCreditService.manualAdjust(
      id,
      Number(body.amount),
      user.id,
      body.note,
    );
    return {
      success: true,
      data: {
        balance: result.balance,
        transaction: {
          id: result.transaction.id,
          type: result.transaction.type,
          amount: parseFloat(result.transaction.amount.toString()),
          balanceAfter: parseFloat(result.transaction.balanceAfter.toString()),
          note: result.transaction.note,
          createdAt: result.transaction.createdAt,
        },
      },
    };
  }

  @Post()
  @ApiOperation({ summary: 'Create new customer' })
  async create(@Body() createDto: any) {
    const customer = await this.customersService.create(createDto);
    return {
      success: true,
      data: { customer },
    };
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update customer' })
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateDto: any,
  ) {
    const customer = await this.customersService.update(id, updateDto);
    return {
      success: true,
      data: { customer },
    };
  }

  @Post('merge-duplicates')
  @UseGuards(RolesGuard)
  @Roles(RoleNames.ADMIN)
  @ApiOperation({
    summary: 'Merge customer rows that share a phone number into a single record',
  })
  async mergeDuplicates() {
    const result = await this.customersService.mergeDuplicatesByPhone();
    return {
      success: true,
      data: result,
    };
  }
}
