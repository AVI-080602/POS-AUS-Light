import {
  Controller,
  Get,
  Post,
  Param,
  ParseIntPipe,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { SyncService } from './sync.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles, RoleNames } from '../auth/decorators/roles.decorator';

@ApiTags('sync')
@Controller('sync')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class SyncController {
  constructor(private readonly syncService: SyncService) {}

  @Get('status')
  @Roles(RoleNames.ADMIN, RoleNames.MANAGER)
  @ApiOperation({ summary: 'Get sync status' })
  async getStatus() {
    const status = await this.syncService.getSyncStatus();
    return {
      success: true,
      data: status,
    };
  }

  // Live progress of the running (or last finished) sync — polled by
  // the Settings page to draw the progress bar.
  @Get('progress')
  @Roles(RoleNames.ADMIN, RoleNames.MANAGER)
  @ApiOperation({ summary: 'Live progress of the current/last sync run' })
  getProgress() {
    return {
      success: true,
      data: this.syncService.getSyncProgress(),
    };
  }

  @Get('test-connection')
  @Roles(RoleNames.ADMIN)
  @ApiOperation({ summary: 'Test Magento connection' })
  async testConnection() {
    const result = await this.syncService.testConnection();
    return {
      success: result.success,
      message: result.message,
      data: result.productCount ? { productCount: result.productCount } : undefined,
    };
  }

  @Post('categories')
  @Roles(RoleNames.ADMIN)
  @ApiOperation({
    summary: 'Sync categories from Magento (runs in background)',
  })
  async syncCategories() {
    // Fire-and-forget — large catalog syncs blow past nginx/CF gateway
    // timeouts (~60-100s) when waited on synchronously. Results land
    // in sync_logs; check pm2 logs or the Settings page for status.
    this.syncService
      .syncCategories()
      .then((result) => {
        if (!result.success) {
          // eslint-disable-next-line no-console
          console.error(
            '[syncCategories] failed:',
            result.message,
            result.errors,
          );
        } else {
          // eslint-disable-next-line no-console
          console.log('[syncCategories] done:', result.message);
        }
      })
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.error('[syncCategories] threw:', err);
      });
    return {
      success: true,
      message:
        'Category sync started in background. Refresh the Settings / Products page in a couple of minutes.',
    };
  }

  @Post('products')
  @Roles(RoleNames.ADMIN)
  @ApiOperation({
    summary: 'Sync products from Magento (runs in background)',
  })
  async syncProducts() {
    // Fire-and-forget — see syncCategories for rationale.
    this.syncService
      .syncProducts()
      .then((result) => {
        if (!result.success) {
          // eslint-disable-next-line no-console
          console.error(
            '[syncProducts] failed:',
            result.message,
            result.errors,
          );
        } else {
          // eslint-disable-next-line no-console
          console.log('[syncProducts] done:', result.message);
        }
      })
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.error('[syncProducts] threw:', err);
      });
    return {
      success: true,
      message:
        'Product sync started in background. With ~15k SKUs this can take 5-15 minutes. Refresh the Products page periodically; check pm2 logs for completion.',
    };
  }

  @Post('orders/:id/push')
  @Roles(RoleNames.ADMIN, RoleNames.MANAGER)
  @ApiOperation({ summary: 'Push a single POS order to Magento (manual retry)' })
  async pushOrder(@Param('id', ParseIntPipe) id: number) {
    const result = await this.syncService.pushOrderToMagento(id);
    return {
      success: result.success,
      message: result.message,
    };
  }

  @Post('orders/push-pending')
  @Roles(RoleNames.ADMIN)
  @ApiOperation({
    summary: 'Push every POS order that is still PENDING to Magento',
  })
  async pushPending() {
    const result = await this.syncService.pushPendingPosOrders();
    return {
      success: result.success,
      message: result.message,
      errors: result.errors,
    };
  }

  @Post('orders')
  @Roles(RoleNames.ADMIN)
  @ApiOperation({ summary: 'Sync orders from Magento (runs in background)' })
  async syncOrders() {
    // Fire-and-forget so nginx doesn't time out on long syncs.
    // Progress/results are written to sync_logs; poll /sync/orders-status for progress.
    this.syncService
      .syncOrders()
      .then((result) => {
        if (!result.success) {
          // eslint-disable-next-line no-console
          console.error('[syncOrders] failed:', result.message, result.errors);
        }
      })
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.error('[syncOrders] threw:', err);
      });

    return {
      success: true,
      message: 'Order sync started in background. Check Orders page / sync status for progress.',
    };
  }

  @Get('orders-status')
  @Roles(RoleNames.ADMIN, RoleNames.MANAGER)
  @ApiOperation({ summary: 'Get order sync progress' })
  async getOrderSyncStatus() {
    const progress = this.syncService.getOrderSyncProgress();
    return { success: true, data: progress };
  }

  @Post('customers')
  @Roles(RoleNames.ADMIN)
  @ApiOperation({
    summary: 'Sync customers from Magento (runs in background)',
  })
  async syncCustomers() {
    this.syncService
      .syncCustomers()
      .then((result) => {
        if (!result.success) {
          // eslint-disable-next-line no-console
          console.error(
            '[syncCustomers] failed:',
            result.message,
            result.errors,
          );
        } else {
          // eslint-disable-next-line no-console
          console.log('[syncCustomers] done:', result.message);
        }
      })
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.error('[syncCustomers] threw:', err);
      });
    return {
      success: true,
      message:
        'Customer sync started in background. Check pm2 logs or refresh the Customers page.',
    };
  }

  @Post('full')
  @Roles(RoleNames.ADMIN)
  @ApiOperation({
    summary:
      'Full sync — categories, products, customers (runs in background)',
  })
  async fullSync() {
    this.syncService
      .fullSync()
      .then((result) => {
        if (!result.success) {
          // eslint-disable-next-line no-console
          console.error('[fullSync] failed:', result.message, result.errors);
        } else {
          // eslint-disable-next-line no-console
          console.log('[fullSync] done:', result.message);
        }
      })
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.error('[fullSync] threw:', err);
      });
    return {
      success: true,
      message:
        'Full sync started in background. Expect 10-20 minutes for the full catalog. Check pm2 logs for completion.',
    };
  }

  @Post('clear-and-sync')
  @Roles(RoleNames.ADMIN)
  @ApiOperation({
    summary: 'Clear all data and sync fresh from Magento (runs in background)',
  })
  async clearAndSync() {
    this.syncService
      .clearAndSync()
      .then((result) => {
        if (!result.success) {
          // eslint-disable-next-line no-console
          console.error(
            '[clearAndSync] failed:',
            result.message,
            result.errors,
          );
        } else {
          // eslint-disable-next-line no-console
          console.log('[clearAndSync] done:', result.message);
        }
      })
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.error('[clearAndSync] threw:', err);
      });
    return {
      success: true,
      message:
        'Clear-and-resync started in background. Catalog will be empty briefly while it rebuilds. Check pm2 logs for completion.',
    };
  }

  @Post('clear')
  @Roles(RoleNames.ADMIN)
  @ApiOperation({ summary: 'Clear all products and categories (WARNING: destructive)' })
  async clearData() {
    const result = await this.syncService.clearDummyData();
    return {
      success: result.success,
      message: result.message,
    };
  }

  @Post('stock')
  @Roles(RoleNames.ADMIN)
  @ApiOperation({
    summary:
      'Sync stock quantities only (runs in background, faster than full sync)',
  })
  async syncStock() {
    this.syncService
      .syncStockOnly()
      .then((result) => {
        if (!result.success) {
          // eslint-disable-next-line no-console
          console.error('[syncStock] failed:', result.message, result.errors);
        } else {
          // eslint-disable-next-line no-console
          console.log('[syncStock] done:', result.message);
        }
      })
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.error('[syncStock] threw:', err);
      });
    return {
      success: true,
      message:
        'Stock sync started in background. Check pm2 logs for completion.',
    };
  }
}
