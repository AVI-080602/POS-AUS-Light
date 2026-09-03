import { Controller, Get, Post, Query, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles, RoleNames } from '../auth/decorators/roles.decorator';
import { PriceWatchService } from './price-watch.service';

// Competitor price dashboard. Admin only end to end — supplier costs
// are the most commercially sensitive data in the system.
@ApiTags('price-watch')
@Controller('price-watch')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(RoleNames.ADMIN)
@ApiBearerAuth()
export class PriceWatchController {
  constructor(private readonly priceWatchService: PriceWatchService) {}

  @Get('summary')
  @ApiOperation({ summary: 'Dashboard cards + last run info' })
  async summary() {
    return { success: true, data: await this.priceWatchService.getSummary() };
  }

  @Get('products')
  @ApiOperation({ summary: 'Filtered/paged comparison rows' })
  async products(
    @Query('search') search?: string,
    @Query('supplier') supplier?: string,
    @Query('category') category?: string,
    @Query('competitor') competitor?: string,
    @Query('verdict') verdict?: string,
    @Query('moversOnly') moversOnly?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const data = await this.priceWatchService.getRows({
      search,
      supplier,
      category,
      competitor,
      verdict,
      moversOnly: moversOnly === 'true',
      page: Math.max(1, parseInt(page || '1', 10) || 1),
      limit: Math.min(200, Math.max(1, parseInt(limit || '50', 10) || 50)),
    });
    return { success: true, data };
  }

  @Get('export')
  @ApiOperation({ summary: 'CSV export of the filtered rows' })
  async export(
    @Res() res: Response,
    @Query('search') search?: string,
    @Query('supplier') supplier?: string,
    @Query('category') category?: string,
    @Query('competitor') competitor?: string,
    @Query('verdict') verdict?: string,
    @Query('moversOnly') moversOnly?: string,
  ) {
    const csv = await this.priceWatchService.exportCsv({
      search,
      supplier,
      category,
      competitor,
      verdict,
      moversOnly: moversOnly === 'true',
    });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="competitor-prices-${new Date().toISOString().slice(0, 10)}.csv"`,
    );
    // Excel needs the BOM to read UTF-8 correctly.
    res.send('﻿' + csv);
  }

  // Manual trigger for the first population and debugging (curl-able by
  // Avi; deliberately no button in Sally's UI — the weekly cron is the
  // normal path). Fire-and-forget: the scrape takes ~15 minutes.
  @Post('run')
  @ApiOperation({ summary: 'Start a scrape run now (admin, background)' })
  async run() {
    if (this.priceWatchService.isRunning()) {
      return { success: false, message: 'A scrape run is already in progress' };
    }
    this.priceWatchService
      .runScrape('manual')
      .catch(() => {
        /* logged + recorded on the run row by the service */
      });
    return { success: true, message: 'Scrape started — check back in ~15 minutes' };
  }
}
