import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';

// Feature modules
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { ProductsModule } from './modules/products/products.module';
import { CustomersModule } from './modules/customers/customers.module';
import { OrdersModule } from './modules/orders/orders.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { DiscountsModule } from './modules/discounts/discounts.module';
import { QuotesModule } from './modules/quotes/quotes.module';
import { InquiriesModule } from './modules/inquiries/inquiries.module';
import { SuppliersModule } from './modules/suppliers/suppliers.module';
import { WarrantiesModule } from './modules/warranties/warranties.module';
import { SyncModule } from './modules/sync/sync.module';
import { ReportsModule } from './modules/reports/reports.module';
import { SettingsModule } from './modules/settings/settings.module';
import { CompetitorModule } from './modules/competitor/competitor.module';
import { PriceWatchModule } from './modules/price-watch/price-watch.module';

// Database configuration
import { getDatabaseConfig } from './database/database.config';

@Module({
  imports: [
    // Configuration
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
    }),

    // Database
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: getDatabaseConfig,
      inject: [ConfigService],
    }),

    // Serve frontend static files in production
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', '..', 'frontend', 'dist'),
      exclude: ['/api/v1*'],
    }),

    // Scheduled tasks (for sync jobs)
    ScheduleModule.forRoot(),

    // Feature modules
    AuthModule,
    UsersModule,
    ProductsModule,
    CustomersModule,
    OrdersModule,
    PaymentsModule,
    DiscountsModule,
    QuotesModule,
    InquiriesModule,
    SuppliersModule,
    WarrantiesModule,
    SyncModule,
    ReportsModule,
    SettingsModule,
    CompetitorModule,
    PriceWatchModule,
  ],
})
export class AppModule {}
