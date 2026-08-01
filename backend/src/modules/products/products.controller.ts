import {
  Controller,
  Get,
  Put,
  Body,
  Param,
  Query,
  UseGuards,
  ParseIntPipe,
  NotFoundException,
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
import { TradeDiscountsService } from './trade-discounts.service';
import { SettingsService } from '../settings/settings.service';
import { SettingType } from '../settings/entities/setting.entity';
import {
  DEFAULT_TRADE_RULES,
  normaliseTradeRules,
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
    return roleName === RoleNames.MANAGER || roleName === RoleNames.ADMIN;
  }

  // findOne/findByBarcode/findBySku return the raw TypeORM entity rather
  // than a hand-mapped DTO (unlike findAll/detail below) — strip `cost`
  // for anyone who isn't allowed to see it.
  private hideCostIfNeeded(product: Product, canSeeCost: boolean): Product {
    if (canSeeCost) return product;
    const { cost, ...rest } = product;
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
          isOnSale: p.isOnSale,
          effectivePrice: p.effectivePrice,
          // Cost — manager/admin only. Used by the cart to warn when a
          // sale drops the unit price below cost+30% (the minimum margin
          // guard the backend also enforces on order creation).
          cost:
            canSeeCost && p.cost != null ? parseFloat(p.cost.toString()) : null,
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

  // Trade auto-discount rules. Declared before @Get(':id') so the path
  // isn't swallowed by the id route. Read is manager/admin (they're the
  // ones who can see margins anyway), write is admin only.
  @Get('trade-rules')
  @UseGuards(RolesGuard)
  @Roles(RoleNames.ADMIN, RoleNames.MANAGER)
  @ApiOperation({ summary: 'Get the trade auto-discount rules' })
  async getTradeRules() {
    const rules = await this.tradeDiscounts.getRules();
    return { success: true, data: { rules, defaults: DEFAULT_TRADE_RULES } };
  }

  @Put('trade-rules')
  @UseGuards(RolesGuard)
  @Roles(RoleNames.ADMIN)
  @ApiOperation({ summary: 'Update the trade auto-discount rules' })
  async updateTradeRules(
    @Body() dto: { rules?: unknown },
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
    // Drop the cached copy so the next priced line uses the new rates
    // immediately rather than waiting out the TTL.
    this.tradeDiscounts.invalidateRulesCache();
    return {
      success: true,
      message: 'Trade pricing rules updated successfully',
      data: { rules },
    };
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
          brand: product.brand || null,
          specialPriceFrom: product.specialPriceFrom,
          specialPriceTo: product.specialPriceTo,
          isOnSale: product.isOnSale,
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
