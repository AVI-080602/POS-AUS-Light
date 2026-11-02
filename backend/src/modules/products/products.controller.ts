import {
  Controller,
  Get,
  Put,
  Patch,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  ParseIntPipe,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ProductsService } from './products.service';
import { MagentoService } from '../sync/magento.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles, RoleNames } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Product } from './entities/product.entity';
import {
  TradeDiscountsService,
  MIN_MARGIN_SETTING_KEY,
  normaliseMarginPercent,
} from './trade-discounts.service';
import {
  DEFAULT_PROMOTION,
  PROMOTION_SETTING_KEY,
  normalisePromotion,
} from './promotion.defaults';
import { SettingsService } from '../settings/settings.service';
import { SettingType } from '../settings/entities/setting.entity';
import {
  DEFAULT_TRADE_RULES,
  normaliseTradeRules,
  TRADE_PAUSE_SETTING_KEY,
  normalisePausedUntil,
} from './trade-rules.defaults';

// Whitelist of Magento custom_attributes to show as "specifications".
// Everything not in this list is considered internal / boring metadata.
const SPEC_WHITELIST = new Set([
  'color',
  'colour',
  'material',
  'finish',
  'style',
  'brand',
  'manufacturer',
  'watts',
  'wattage',
  'power',
  'voltage',
  'lumens',
  'kelvin',
  'colour_temperature',
  'color_temperature',
  'beam_angle',
  'ip_rating',
  'dimmable',
  'bulb_type',
  'bulb_included',
  'number_of_bulbs',
  'number_of_lights',
  'cable_length',
  'diameter',
  'height',
  'width',
  'length',
  'depth',
  'weight',
  'warranty',
  'warranty_years',
  'installation',
  'certification',
  'energy_rating',
  'efficiency',
  'country_of_origin',
  'model',
  'model_number',
  'size',
  'shape',
  'mounting',
  'indoor_outdoor',
  'application',
  'rating',
  'class_rating',
]);

const PRETTY_LABELS: Record<string, string> = {
  ip_rating: 'IP Rating',
  colour_temperature: 'Colour Temperature',
  color_temperature: 'Colour Temperature',
  beam_angle: 'Beam Angle',
  bulb_type: 'Bulb Type',
  bulb_included: 'Bulb Included',
  number_of_bulbs: 'Number of Bulbs',
  number_of_lights: 'Number of Lights',
  cable_length: 'Cable Length',
  warranty_years: 'Warranty (Years)',
  country_of_origin: 'Country of Origin',
  model_number: 'Model Number',
  indoor_outdoor: 'Indoor / Outdoor',
  class_rating: 'Class Rating',
  energy_rating: 'Energy Rating',
};

function prettyLabel(code: string): string {
  if (PRETTY_LABELS[code]) return PRETTY_LABELS[code];
  return code
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

@ApiTags('products')
@Controller('products')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class ProductsController {
  private readonly logger = new Logger(ProductsController.name);

  constructor(
    private readonly productsService: ProductsService,
    private readonly magentoService: MagentoService,
    private readonly tradeDiscounts: TradeDiscountsService,
    private readonly settingsService: SettingsService,
  ) {}

  // Cost is commercially sensitive — only managers/admins see it. Every
  // endpoint below that touches `cost` gates it through this check.
  private canSeeCost(user: any): boolean {
    const roleName = user?.role?.name;
    return roleName === RoleNames.MANAGER || roleName === RoleNames.ADMIN || roleName === RoleNames.PRICE_MATCH;
  }

  // findOne/findByBarcode/findBySku return the raw TypeORM entity rather
  // than a hand-mapped DTO (unlike findAll/detail below) — strip `cost`
  // for anyone who isn't allowed to see it.
  private hideCostIfNeeded(product: Product, canSeeCost: boolean): Product {
    if (canSeeCost) return product;
    const { cost, bulkCost, bulkMinQty, ...rest } = product;
    return rest as Product;
  }

  @Get()
  @ApiOperation({ summary: 'Search and list products' })
  async findAll(
    @Query('search') search?: string,
    @Query('category') category?: number,
    @Query('inStock') inStock?: boolean,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @CurrentUser() user?: any,
  ) {
    const { products, total } = await this.productsService.findAll({
      search,
      category,
      inStock,
      page,
      limit,
    });
    const canSeeCost = this.canSeeCost(user);

    return {
      success: true,
      data: {
        products: products.map((p) => ({
          id: p.id,
          magentoId: p.magentoId,
          sku: p.sku,
          name: p.name,
          price: parseFloat(p.price.toString()),
          specialPrice: p.specialPrice
            ? parseFloat(p.specialPrice.toString())
            : null,
          // Frontend uses these to recompute isOnSale itself (so it can
          // hide a stale special price after the to-date passes without
          // waiting for the next sync); also surface the precomputed flag
          // for the cart so the cashier total agrees with the server.
          specialPriceFrom: p.specialPriceFrom,
          specialPriceTo: p.specialPriceTo,
          // Special-price window OR Sale/Clearance category membership
          // (Coolum-style "Sale" tags without a special price).
          isOnSale: p.countsAsSale,
          // Eglo / Havit: special price is the everyday price — no SALE tag.
          everydayPrice: p.isEverydayPriceBrand,
          effectivePrice: p.effectivePrice,
          // Cost — manager/admin only. Used by the cart to warn when a
          // sale drops the unit price below cost+30% (the minimum margin
          // guard the backend also enforces on order creation).
          cost:
            canSeeCost && p.cost != null ? parseFloat(p.cost.toString()) : null,
          // Per-product trade price (null = priced by the trade rules).
          tradePrice:
            p.tradePrice != null ? parseFloat(p.tradePrice.toString()) : null,
          brand: p.brand || null,
          stockQty: p.stockQty,
          isInStock: p.isInStock,
          imageUrl: p.imageUrl,
          thumbnailUrl: p.thumbnailUrl,
          productType: p.productType,
          barcode: p.barcode,
          categories: p.categories?.map((c) => ({
            id: c.id,
            name: c.name,
          })),
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

  // Pricing config every till needs: the minimum margin over cost.
  // Readable by any signed-in user (the cart warns with it); only
  // admins change it. Declared before @Get(':id').
  @Get('pricing-config')
  @ApiOperation({ summary: 'Get pricing config (minimum margin percent)' })
  async getPricingConfig() {
    return {
      success: true,
      data: { minMarginPercent: await this.tradeDiscounts.getMinMarginPercent() },
    };
  }

  @Put('pricing-config')
  @UseGuards(RolesGuard)
  @Roles(RoleNames.ADMIN)
  @ApiOperation({ summary: 'Update pricing config (minimum margin percent)' })
  async updatePricingConfig(
    @Body() dto: { minMarginPercent?: number | string },
    @CurrentUser() user: any,
  ) {
    const raw = dto?.minMarginPercent;
    const n = Number(raw);
    if (raw === undefined || raw === null || raw === '' || !Number.isFinite(n) || n < 0 || n > 500) {
      throw new BadRequestException('Minimum margin must be a percent between 0 and 500');
    }
    const minMarginPercent = normaliseMarginPercent(n);
    await this.settingsService.set(
      MIN_MARGIN_SETTING_KEY,
      minMarginPercent,
      SettingType.NUMBER,
      'Minimum margin over cost (percent) enforced at the till',
      user?.id,
    );
    this.tradeDiscounts.invalidateMarginCache();
    this.logger.log(`Minimum margin set to ${minMarginPercent}% by user #${user?.id ?? '?'}`);
    return {
      success: true,
      message: `Minimum margin is now cost + ${minMarginPercent}%`,
      data: { minMarginPercent },
    };
  }

  // Store-wide promotion (fans 10% at checkout, Oct 2026). Declared
  // before @Get(':id'). Managers can view, admins change it.
  @Get('promotion')
  @UseGuards(RolesGuard)
  @Roles(RoleNames.ADMIN, RoleNames.MANAGER)
  @ApiOperation({ summary: 'Get the checkout promotion and how many products it covers' })
  async getPromotion() {
    const promotion = await this.tradeDiscounts.getPromotion();
    const summary = await this.tradeDiscounts.promotionSummary();
    return { success: true, data: { promotion, defaults: DEFAULT_PROMOTION, summary } };
  }

  // What the till's red banner shows. Any signed-in staff.
  @Get('promotion/active')
  @ApiOperation({ summary: 'The running checkout promotion, for the POS banner' })
  async getActivePromotion() {
    const promo = await this.tradeDiscounts.getPromotion();
    const active = await this.tradeDiscounts.isPromotionActive();
    return {
      success: true,
      data: {
        active,
        showBanner: active && promo.showBanner,
        percent: promo.percent,
        label: promo.label,
        endsOn: promo.endsOn,
        bannerText: promo.bannerText.replace(/\{percent\}/g, String(promo.percent)),
      },
    };
  }

  @Put('promotion')
  @UseGuards(RolesGuard)
  @Roles(RoleNames.ADMIN)
  @ApiOperation({ summary: 'Update the checkout promotion' })
  async updatePromotion(@Body() dto: Record<string, unknown>, @CurrentUser() user: any) {
    const promotion = normalisePromotion(dto);
    await this.settingsService.set(
      PROMOTION_SETTING_KEY,
      promotion,
      SettingType.JSON,
      'Store-wide checkout promotion (all customers)',
      user?.id,
    );
    this.tradeDiscounts.invalidatePromotionCache();
    this.logger.log(`Promotion updated by user #${user?.id ?? '?'}: ${JSON.stringify(promotion)}`);
    const summary = await this.tradeDiscounts.promotionSummary();
    return {
      success: true,
      message: promotion.enabled
        ? `${promotion.label}: ${promotion.percent}% off is on`
        : `${promotion.label} is off`,
      data: { promotion, summary },
    };
  }

  // Trade auto-discount rules. Declared before @Get(':id') so the path
  // isn't swallowed by the id route. Read is manager/admin (they're the
  // ones who can see margins anyway), write is admin only.
  @Get('trade-rules')
  @UseGuards(RolesGuard)
  @Roles(RoleNames.ADMIN, RoleNames.MANAGER)
  @ApiOperation({ summary: 'Get the trade auto-discount rules' })
  async getTradeRules() {
    const rules = await this.tradeDiscounts.getRules();
    const pausedUntil = await this.tradeDiscounts.getRulesPausedUntil();
    return { success: true, data: { rules, defaults: DEFAULT_TRADE_RULES, pausedUntil } };
  }

  @Put('trade-rules')
  @UseGuards(RolesGuard)
  @Roles(RoleNames.ADMIN)
  @ApiOperation({ summary: 'Update the trade auto-discount rules' })
  async updateTradeRules(
    @Body() dto: { rules?: unknown; pausedUntil?: unknown },
    @CurrentUser() user: any,
  ) {
    const rules = normaliseTradeRules(dto?.rules);
    await this.settingsService.set(
      'trade_discount_rules',
      rules,
      SettingType.JSON,
      'Trade customer auto-discount rules',
      user?.id,
    );
    // Sent only by a Settings page that shows the pause; '' or null ends it.
    if (dto && 'pausedUntil' in dto) {
      await this.settingsService.set(
        TRADE_PAUSE_SETTING_KEY,
        normalisePausedUntil(dto.pausedUntil) ?? '',
        SettingType.STRING,
        'Trade rules paused up to and including this day',
        user?.id,
      );
    }
    // Drop the cached copy so the next priced line uses the new rates
    // immediately rather than waiting out the TTL.
    this.tradeDiscounts.invalidateRulesCache();
    return {
      success: true,
      message: 'Trade pricing rules updated successfully',
      data: { rules },
    };
  }

  // On-the-spot cost correction (Sally, 10 Sep 2026: "a cost price edit
  // field on the product for admins/managers"). Same audience that can
  // see cost. Send null to clear it.
  @Patch(':id/cost')
  @UseGuards(RolesGuard)
  @Roles(RoleNames.ADMIN, RoleNames.MANAGER, RoleNames.PRICE_MATCH)
  @ApiOperation({ summary: 'Update the supplier cost (inc GST) of a product' })
  async updateCost(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: { cost?: number | string | null },
    @CurrentUser() user: any,
  ) {
    let cost: number | null;
    if (dto?.cost === null || dto?.cost === undefined || dto?.cost === '') {
      cost = null;
    } else {
      const n = Number(dto.cost);
      if (!Number.isFinite(n) || n < 0) {
        throw new BadRequestException('Cost must be a number of 0 or more');
      }
      cost = Math.round(n * 100) / 100;
    }
    const before = await this.productsService.findById(id);
    const product = await this.productsService.updateCost(id, cost);
    this.logger.log(
      `Cost changed on ${product.sku} (#${id}): ${before?.cost ?? 'null'} -> ${cost ?? 'null'} by user #${user?.id ?? '?'}`,
    );
    return {
      success: true,
      message: cost == null ? 'Cost cleared' : `Cost set to $${cost.toFixed(2)}`,
      data: { id: product.id, sku: product.sku, cost },
    };
  }

  // Per-product trade price (Sally, 29 Sep 2026). Replaces the trade
  // percentage for this one product. Managers and admins can set it;
  // going under the minimum margin needs an admin, who must confirm.
  // Send null to clear it and return the product to the trade rules.
  @Patch(':id/trade-price')
  @UseGuards(RolesGuard)
  @Roles(RoleNames.ADMIN, RoleNames.MANAGER)
  @ApiOperation({ summary: 'Set or clear the fixed trade price of a product' })
  async updateTradePrice(
    @Param('id', ParseIntPipe) id: number,
    @Body()
    dto: { tradePrice?: number | string | null; confirmBelowFloor?: boolean },
    @CurrentUser() user: any,
  ) {
    const before = await this.productsService.findById(id);
    if (!before) throw new NotFoundException(`Product ${id} not found`);

    let tradePrice: number | null;
    let belowFloor = false;
    if (dto?.tradePrice === null || dto?.tradePrice === undefined || dto?.tradePrice === '') {
      tradePrice = null;
    } else {
      const n = Number(dto.tradePrice);
      if (!Number.isFinite(n) || n <= 0) {
        throw new BadRequestException('Trade price must be a number above 0');
      }
      tradePrice = Math.round(n * 100) / 100;
      const rrp = Number(before.price);
      if (tradePrice >= rrp) {
        throw new BadRequestException(
          `Trade price must be below the retail price ($${rrp.toFixed(2)})`,
        );
      }
      const cost = before.cost != null ? Number(before.cost) : null;
      if (cost != null && cost > 0) {
        const pct = await this.tradeDiscounts.getMinMarginPercent();
        const floor = Math.round(cost * (1 + pct / 100) * 100) / 100;
        if (tradePrice < floor - 0.005) {
          belowFloor = true;
          const isAdmin = user?.role?.name === RoleNames.ADMIN;
          const detail =
            `$${tradePrice.toFixed(2)} is below the minimum margin ` +
            `(cost $${cost.toFixed(2)} + ${pct}% = $${floor.toFixed(2)}).`;
          if (!isAdmin) {
            throw new BadRequestException({
              success: false,
              code: 'BELOW_COST_FLOOR',
              message: `${detail} Only an admin can approve a trade price under the minimum.`,
              floor,
            });
          }
          if (!dto?.confirmBelowFloor) {
            throw new BadRequestException({
              success: false,
              code: 'BELOW_COST_FLOOR_CONFIRM',
              message: detail,
              floor,
            });
          }
        }
      }
    }

    const product = await this.productsService.updateTradePrice(id, tradePrice);
    this.logger.log(
      `Trade price changed on ${product.sku} (#${id}): ${before.tradePrice ?? 'rule'} -> ` +
        `${tradePrice ?? 'rule'}${belowFloor ? ' (below margin floor, admin-confirmed)' : ''} ` +
        `by user #${user?.id ?? '?'}`,
    );
    const auto = await this.tradeDiscounts.getAutoDiscount(
      (await this.productsService.findById(id)) as Product,
    );
    return {
      success: true,
      message:
        tradePrice == null
          ? 'Trade price cleared — back on the trade rules'
          : `Trade price set to $${tradePrice.toFixed(2)}`,
      data: {
        id: product.id,
        sku: product.sku,
        tradePrice,
        belowFloor,
        percent: auto.percent,
      },
    };
  }

  // Instant below-margin check for a price typed in the cart (Sally, 14
  // Oct 2026: "can the warning for below cost price pop up as soon as
  // user changes the price ... than at checkout?"). Same rule as the
  // checkout guard: cost + minimum margin, and a trade price set on the
  // product counts as approved for a trade sale. Sales staff get yes/no
  // only — the minimum price would reveal the cost — managers and admins
  // also get the minimum.
  @Post('margin-check')
  @ApiOperation({ summary: 'Is this price below cost + minimum margin?' })
  async marginCheck(
    @Body() body: { items?: Array<{ productId: number; price: number; trade?: boolean }> },
    @CurrentUser() user: any,
  ) {
    const items = (Array.isArray(body?.items) ? body.items : []).filter(
      (i) => Number(i?.productId) > 0 && Number.isFinite(Number(i?.price)),
    );
    const products = items.length
      ? await this.productsService.findByIds(items.map((i) => Number(i.productId)))
      : [];
    const multiplier = await this.tradeDiscounts.getMinMarginMultiplier();
    const seeCost = this.canSeeCost(user);
    const results: Record<number, { below: boolean; minPrice?: number }> = {};
    for (const it of items) {
      const id = Number(it.productId);
      const p = products.find((x) => x.id === id);
      const cost = p?.cost != null ? Number(p.cost) : 0;
      if (!p || !(cost > 0)) {
        results[id] = { below: false };
        continue;
      }
      const price = Number(it.price);
      const approved =
        !!it.trade &&
        p.tradePrice != null &&
        Number(p.tradePrice) > 0 &&
        price >= Number(p.tradePrice) - 0.005;
      const below = !approved && price < cost * multiplier - 0.005;
      results[id] = seeCost
        ? { below, minPrice: Math.round(cost * multiplier * 100) / 100 }
        : { below };
    }
    return { success: true, data: { results } };
  }

  @Get('categories')
  @ApiOperation({ summary: 'Get category tree' })
  async getCategories() {
    const categories = await this.productsService.getCategoryTree();
    return {
      success: true,
      data: { categories },
    };
  }

  @Get('categories/:id/subcategories')
  @ApiOperation({ summary: 'Get subcategories of a category' })
  async getSubcategories(@Param('id', ParseIntPipe) id: number) {
    const subcategories = await this.productsService.getSubcategories(id);
    const parentCategory = await this.productsService.getCategoryById(id);
    return {
      success: true,
      data: {
        parentCategory: parentCategory
          ? { id: parentCategory.id, name: parentCategory.name }
          : null,
        subcategories,
      },
    };
  }

  @Get('barcode/:barcode')
  @ApiOperation({ summary: 'Lookup product by barcode' })
  async findByBarcode(
    @Param('barcode') barcode: string,
    @CurrentUser() user?: any,
  ) {
    const product = await this.productsService.findByBarcode(barcode);
    if (!product) {
      return {
        success: false,
        error: { code: 'NOT_FOUND', message: 'Product not found' },
      };
    }

    return {
      success: true,
      data: { product: this.hideCostIfNeeded(product, this.canSeeCost(user)) },
    };
  }

  @Get('sku/:sku')
  @ApiOperation({ summary: 'Lookup product by SKU' })
  async findBySku(@Param('sku') sku: string, @CurrentUser() user?: any) {
    const product = await this.productsService.findBySku(sku);
    if (!product) {
      return {
        success: false,
        error: { code: 'NOT_FOUND', message: 'Product not found' },
      };
    }

    return {
      success: true,
      data: { product: this.hideCostIfNeeded(product, this.canSeeCost(user)) },
    };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get product by ID' })
  async findOne(@Param('id', ParseIntPipe) id: number, @CurrentUser() user?: any) {
    const product = await this.productsService.findById(id);
    if (!product) {
      return {
        success: false,
        error: { code: 'NOT_FOUND', message: 'Product not found' },
      };
    }

    return {
      success: true,
      data: { product: this.hideCostIfNeeded(product, this.canSeeCost(user)) },
    };
  }

  @Get(':id/detail')
  @ApiOperation({
    summary: 'Get product detail with live specs + gallery from Magento',
  })
  async detail(@Param('id', ParseIntPipe) id: number, @CurrentUser() user?: any) {
    const product = await this.productsService.findById(id);
    if (!product) throw new NotFoundException('Product not found');
    const canSeeCost = this.canSeeCost(user);

    let specs: Array<{ code: string; label: string; value: string }> = [];
    let gallery: string[] = [];
    let liveError: string | null = null;

    try {
      const magentoProduct = await this.magentoService.fetchProductBySku(
        product.sku,
      );

      // Specs: filter custom_attributes by whitelist
      const attrs = magentoProduct.custom_attributes || [];
      for (const attr of attrs) {
        if (!SPEC_WHITELIST.has(attr.attribute_code)) continue;
        const value = attr.value;
        if (
          value === null ||
          value === undefined ||
          value === '' ||
          (Array.isArray(value) && value.length === 0)
        ) {
          continue;
        }
        specs.push({
          code: attr.attribute_code,
          label: prettyLabel(attr.attribute_code),
          value: Array.isArray(value) ? value.join(', ') : String(value),
        });
      }

      // Image gallery: build full URLs from media_gallery_entries
      const baseUrl = this.magentoService.getBaseUrl().replace(/\/$/, '');
      const mediaBase = `${baseUrl}/pub/media/catalog/product`;
      const entries = magentoProduct.media_gallery_entries || [];
      gallery = entries
        .filter((e) => !e.disabled && e.media_type === 'image' && e.file)
        .sort((a, b) => a.position - b.position)
        .map((e) => `${mediaBase}${e.file}`);
    } catch (err: any) {
      this.logger.warn(
        `Failed to fetch live Magento detail for ${product.sku}: ${err?.message || err}`,
      );
      liveError =
        'Live product data from Magento is currently unavailable. Showing cached info.';
    }

    // Fallback gallery: use cached thumbnail/imageUrl
    if (gallery.length === 0) {
      const fallback = [product.imageUrl, product.thumbnailUrl].filter(
        (u): u is string => !!u,
      );
      gallery = fallback;
    }

    return {
      success: true,
      data: {
        product: {
          id: product.id,
          sku: product.sku,
          name: product.name,
          description: product.description,
          shortDescription: product.shortDescription,
          price: parseFloat(product.price.toString()),
          specialPrice: product.specialPrice
            ? parseFloat(product.specialPrice.toString())
            : null,
          cost:
            canSeeCost && product.cost != null
              ? parseFloat(product.cost.toString())
              : null,
          tradePrice:
            product.tradePrice != null
              ? parseFloat(product.tradePrice.toString())
              : null,
          brand: product.brand || null,
          specialPriceFrom: product.specialPriceFrom,
          specialPriceTo: product.specialPriceTo,
          isOnSale: product.countsAsSale,
          everydayPrice: product.isEverydayPriceBrand,
          effectivePrice: product.effectivePrice,
          stockQty: product.stockQty,
          isInStock: product.isInStock,
          thumbnailUrl: product.thumbnailUrl,
          imageUrl: product.imageUrl,
        },
        specs,
        gallery,
        liveError,
      },
    };
  }
}
