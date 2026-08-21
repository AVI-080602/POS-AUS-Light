import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SupplierCost } from './entities/supplier-cost.entity';
import { ScrapeRun } from './entities/scrape-run.entity';
import { CompetitorPriceSnapshot } from './entities/competitor-price.entity';
import { Product } from '../products/entities/product.entity';
import { PriceWatchService } from './price-watch.service';
import { PriceWatchController } from './price-watch.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([SupplierCost, ScrapeRun, CompetitorPriceSnapshot, Product]),
  ],
  controllers: [PriceWatchController],
  providers: [PriceWatchService],
  exports: [PriceWatchService],
})
export class PriceWatchModule {}
