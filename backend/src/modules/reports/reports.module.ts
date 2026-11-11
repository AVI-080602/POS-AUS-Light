import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ReportsService } from './reports.service';
import { ReportsController } from './reports.controller';
import { DayClose } from './entities/day-close.entity';
import { PurchaseOrder } from './entities/purchase-order.entity';
// The minimum margin setting, for the Below Cost report.
import { ProductsModule } from '../products/products.module';
// Completing back-order lines from the Backorders report.
import { OrdersModule } from '../orders/orders.module';

@Module({
  imports: [TypeOrmModule.forFeature([DayClose, PurchaseOrder]), ProductsModule, OrdersModule],
  controllers: [ReportsController],
  providers: [ReportsService],
  exports: [ReportsService],
})
export class ReportsModule {}
