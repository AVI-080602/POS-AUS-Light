import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { MagentoService, MagentoProduct, MagentoCustomer, MagentoOrder } from './magento.service';
import { Product, ProductType } from '../products/entities/product.entity';
import { Category } from '../products/entities/category.entity';
import { Customer, SyncStatus } from '../customers/entities/customer.entity';
import { Order, OrderStatus, PaymentStatus, OrderSyncStatus, OrderSource } from '../orders/entities/order.entity';
import { OrderItem } from '../orders/entities/order-item.entity';
import { SyncLog, SyncType, SyncDirection, SyncLogStatus } from './entities/sync-log.entity';

export interface SyncResult {
  success: boolean;
  message: string;
  productsCreated?: number;
  productsUpdated?: number;
  categoriesCreated?: number;
  categoriesUpdated?: number;
  customersCreated?: number;
  customersUpdated?: number;
  errors?: string[];
}

export interface OrderSyncProgress {
  running: boolean;
  startedAt: Date | null;
  finishedAt: Date | null;
  fetched: number;
  processed: number;
  created: number;
  updated: number;
  errors: number;
  lastError: string | null;
  message: string;
}

@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);

  private orderSyncProgress: OrderSyncProgress = {
    running: false,
    startedAt: null,
    finishedAt: null,
    fetched: 0,
    processed: 0,
    created: 0,
    updated: 0,
    errors: 0,
    lastError: null,
    message: 'Idle',
  };

  getOrderSyncProgress(): OrderSyncProgress {
    return this.orderSyncProgress;
  }

  constructor(
    private readonly magentoService: MagentoService,
    private readonly dataSource: DataSource,
    @InjectRepository(Product)
    private readonly productRepository: Repository<Product>,
    @InjectRepository(Category)
    private readonly categoryRepository: Repository<Category>,
    @InjectRepository(Customer)
    private readonly customerRepository: Repository<Customer>,
    @InjectRepository(Order)
    private readonly orderRepository: Repository<Order>,
    @InjectRepository(OrderItem)
    private readonly orderItemRepository: Repository<OrderItem>,
    @InjectRepository(SyncLog)
    private readonly syncLogRepository: Repository<SyncLog>,
  ) {}

  // id -> label map for the brand attribute. Refreshed at the start of
  // every product sync so a supplier renamed in Magento shows the new
  // name after the next full sync. Empty map means brand translation
  // is unavailable (attribute missing or Magento call failed) — the
  // sync will fall back to storing the raw attribute value.
  private brandOptions: Map<string, string> = new Map();
  // Attribute code we read the brand from. Magento default is
  // `manufacturer`; some stores use `brand`. loadBrandOptions() probes
  // both and locks in whichever one has options defined.
  private brandAttributeCode: string | null = null;

  private async loadBrandOptions(): Promise<void> {
    const candidates = ['manufacturer', 'brand'];
    for (const code of candidates) {
      const options = await this.magentoService.fetchAttributeOptions(code);
      if (options.length > 0) {
        this.brandOptions = new Map(
          options
            .filter((o) => o.value && o.label)
            .map((o) => [String(o.value), String(o.label)]),
        );
        this.brandAttributeCode = code;
        this.logger.log(
          `Brand attribute resolved: '${code}' with ${this.brandOptions.size} options`,
        );
        return;
      }
    }
    this.brandOptions = new Map();
    this.brandAttributeCode = null;
    this.logger.warn(
      'No brand attribute found on Magento (tried: manufacturer, brand). Products will sync without brand.',
    );
  }

  async testConnection(): Promise<{ success: boolean; message: string; productCount?: number }> {
    return this.magentoService.testConnection();
  }

  async clearDummyData(): Promise<{ success: boolean; message: string }> {
    this.logger.log('Clearing dummy data...');

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // Disable foreign key checks temporarily
      await queryRunner.query('SET FOREIGN_KEY_CHECKS = 0');

      // Clear product_categories junction table
      await queryRunner.query('DELETE FROM product_categories');

      // Clear products
      const productResult = await queryRunner.query('DELETE FROM products');

      // Clear categories
      const categoryResult = await queryRunner.query('DELETE FROM categories');

      // Reset auto-increment
      await queryRunner.query('ALTER TABLE products AUTO_INCREMENT = 1');
      await queryRunner.query('ALTER TABLE categories AUTO_INCREMENT = 1');

      // Re-enable foreign key checks
      await queryRunner.query('SET FOREIGN_KEY_CHECKS = 1');

      await queryRunner.commitTransaction();

      this.logger.log('Dummy data cleared successfully');
      return {
        success: true,
        message: `Cleared all products and categories`,
      };
    } catch (error) {
      await queryRunner.rollbackTransaction();
      this.logger.error('Failed to clear dummy data', error);
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Unknown error',
      };
    } finally {
      await queryRunner.release();
    }
  }

  // ---- live sync progress, polled by Settings → Magento Sync ----
  // In-memory only: survives for the life of the process, shows the
  // current run while it works and the last result after it finishes.
  private syncProgress: {
    task: string;
    phase: string;
    current: number;
    total: number;
    startedAt: string;
    finishedAt: string | null;
    success: boolean | null;
    message: string | null;
  } | null = null;

  getSyncProgress() {
    return this.syncProgress;
  }

  private progressStart(task: string, phase: string) {
    this.syncProgress = {
      task,
      phase,
      current: 0,
      total: 0,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      success: null,
      message: null,
    };
  }

  private progressPhase(phase: string, total = 0) {
    if (this.syncProgress) {
      this.syncProgress.phase = phase;
      this.syncProgress.total = total;
      this.syncProgress.current = 0;
    }
  }

  private progressTick() {
    if (this.syncProgress) this.syncProgress.current++;
  }

  private progressEnd(success: boolean, message: string) {
    if (this.syncProgress) {
      this.syncProgress.finishedAt = new Date().toISOString();
      this.syncProgress.success = success;
      this.syncProgress.message = message;
    }
  }

  async syncCategories(): Promise<SyncResult> {
    this.logger.log('Starting category sync...');
    this.progressStart('categories', 'Syncing categories from Magento…');
    const errors: string[] = [];
    let categoriesCreated = 0;
    let categoriesUpdated = 0;

    try {
      const magentoCategories = await this.magentoService.fetchCategories();

      // First pass: Create/update all categories WITHOUT parent_id
      for (const magentoCat of magentoCategories) {
        try {
          let category = await this.categoryRepository.findOne({
            where: { magentoId: magentoCat.id },
          });

          if (category) {
            // Update existing (without parent for now)
            category.name = magentoCat.name;
            category.level = magentoCat.level;
            category.path = magentoCat.path;
            category.isActive = magentoCat.is_active;
            category.sortOrder = magentoCat.position ?? 0;
            category.syncedAt = new Date();
            await this.categoryRepository.save(category);
            categoriesUpdated++;
          } else {
            // Create new (without parent for now)
            category = this.categoryRepository.create({
              magentoId: magentoCat.id,
              name: magentoCat.name,
              parentId: null, // Set to null initially
              level: magentoCat.level,
              path: magentoCat.path,
              isActive: magentoCat.is_active,
              sortOrder: magentoCat.position ?? 0,
              syncedAt: new Date(),
            });
            await this.categoryRepository.save(category);
            categoriesCreated++;
          }
        } catch (error) {
          const errorMsg = `Failed to sync category ${magentoCat.id}: ${error}`;
          this.logger.error(errorMsg);
          errors.push(errorMsg);
        }
      }

      // Mark categories not returned from Magento as inactive
      const syncedMagentoIds = magentoCategories.map(c => c.id);
      if (syncedMagentoIds.length > 0) {
        const allLocalCategories = await this.categoryRepository.find();
        for (const localCat of allLocalCategories) {
          if (!syncedMagentoIds.includes(localCat.magentoId) && localCat.isActive) {
            localCat.isActive = false;
            localCat.syncedAt = new Date();
            await this.categoryRepository.save(localCat);
            this.logger.log(`Deactivated category "${localCat.name}" (magentoId: ${localCat.magentoId}) - no longer in Magento`);
          }
        }
      }

      // Second pass: Update parent_id references using local IDs
      this.logger.log('Updating category parent references...');
      for (const magentoCat of magentoCategories) {
        if (magentoCat.parent_id && magentoCat.parent_id > 1) {
          try {
            // Find the local category
            const category = await this.categoryRepository.findOne({
              where: { magentoId: magentoCat.id },
            });

            // Find the parent category by its Magento ID
            const parentCategory = await this.categoryRepository.findOne({
              where: { magentoId: magentoCat.parent_id },
            });

            if (category && parentCategory) {
              category.parentId = parentCategory.id; // Use LOCAL id, not magento_id
              await this.categoryRepository.save(category);
            }
          } catch (error) {
            this.logger.warn(`Failed to set parent for category ${magentoCat.id}: ${error}`);
          }
        }
      }

      // Log the sync
      await this.logSync('categories', categoriesCreated + categoriesUpdated, errors.length === 0);

      const message = `Category sync completed: ${categoriesCreated} created, ${categoriesUpdated} updated`;
      this.progressEnd(errors.length === 0, message);
      return {
        success: errors.length === 0,
        message,
        categoriesCreated,
        categoriesUpdated,
        errors: errors.length > 0 ? errors : undefined,
      };
    } catch (error) {
      this.logger.error('Category sync failed', error);
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.progressEnd(false, message);
      return {
        success: false,
        message,
        errors: [String(error)],
      };
    }
  }

  async syncProducts(): Promise<SyncResult> {
    this.logger.log('Starting product sync...');
    this.progressStart('products', 'Fetching catalogue from Magento…');
    const errors: string[] = [];
    let productsCreated = 0;
    let productsUpdated = 0;

    try {
      // Cache the brand attribute id→label map once per sync so we can
      // translate the manufacturer/brand option id into a human label
      // per product below.
      await this.loadBrandOptions();

      const magentoProducts = await this.magentoService.fetchAllProducts();
      this.progressPhase('Saving products to POS', magentoProducts.length);

      // First pass: sync all products
      for (const magentoProd of magentoProducts) {
        this.progressTick();
        try {
          await this.syncSingleProduct(magentoProd);

          const existing = await this.productRepository.findOne({
            where: { magentoId: magentoProd.id },
          });

          if (existing && existing.createdAt.getTime() === existing.updatedAt.getTime()) {
            productsCreated++;
          } else {
            productsUpdated++;
          }
        } catch (error) {
          const errorMsg = `Failed to sync product ${magentoProd.sku}: ${error}`;
          this.logger.error(errorMsg);
          errors.push(errorMsg);
        }
      }

      // Stock quantities are now included in the REST API response (extension_attributes.stock_item)
      // so no separate stock sync pass is needed

      // Log the sync
      await this.logSync('products', productsCreated + productsUpdated, errors.length === 0);

      const message =
        `Product sync completed: ${productsCreated} created, ${productsUpdated} updated` +
        (errors.length > 0 ? ` (${errors.length} errors)` : '');
      this.progressEnd(errors.length === 0, message);
      return {
        success: errors.length === 0,
        message,
        productsCreated,
        productsUpdated,
        errors: errors.length > 0 ? errors : undefined,
      };
    } catch (error) {
      this.logger.error('Product sync failed', error);
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.progressEnd(false, message);
      return {
        success: false,
        message,
        errors: [String(error)],
      };
    }
  }

  // Helper to get a custom attribute value from REST API product
  private getCustomAttribute(magentoProd: MagentoProduct, code: string): any {
    return magentoProd.custom_attributes?.find(
      (attr) => attr.attribute_code === code,
    )?.value;
  }

  private async syncSingleProduct(magentoProd: MagentoProduct): Promise<Product> {
    let product = await this.productRepository.findOne({
      where: { magentoId: magentoProd.id },
      relations: ['categories'],
    });

    const productType = this.mapProductType(magentoProd.type_id);

    // Price comes directly from REST API
    const price = magentoProd.price || 0;

    // Special price from custom attributes
    const specialPriceRaw = this.getCustomAttribute(magentoProd, 'special_price');
    const specialPrice = specialPriceRaw ? parseFloat(specialPriceRaw) : null;
    const specialPriceFrom = this.getCustomAttribute(magentoProd, 'special_from_date') || null;
    const specialPriceTo = this.getCustomAttribute(magentoProd, 'special_to_date') || null;

    // Build image URL from custom attributes
    // Magento serves original images at /pub/media/catalog/product/ path
    const baseUrl = this.magentoService.getBaseUrl();
    const imageFile = this.getCustomAttribute(magentoProd, 'image');
    const thumbnailFile = this.getCustomAttribute(magentoProd, 'thumbnail') || imageFile;
    const imageUrl = imageFile && imageFile !== 'no_selection'
      ? `${baseUrl}/pub/media/catalog/product${imageFile}`
      : null;
    const thumbnailUrl = thumbnailFile && thumbnailFile !== 'no_selection'
      ? `${baseUrl}/pub/media/catalog/product${thumbnailFile}`
      : null;

    // Description from custom attributes
    const descriptionHtml = this.getCustomAttribute(magentoProd, 'description') || '';
    const description = descriptionHtml
      ? descriptionHtml.replace(/<[^>]*>/g, '')
      : null;
    const shortDescription = this.getCustomAttribute(magentoProd, 'short_description') || null;

    // Brand / wholesaler — read the raw value from whichever attribute
    // loadBrandOptions() locked in, then translate the option id via
    // the cached map. If the attribute is text-type or the id isn't in
    // the map, keep the raw value; falls back to null when missing.
    let brand: string | null = null;
    if (this.brandAttributeCode) {
      const rawBrand = this.getCustomAttribute(
        magentoProd,
        this.brandAttributeCode,
      );
      if (rawBrand != null && rawBrand !== '') {
        const key = String(rawBrand);
        brand = this.brandOptions.get(key) || key;
      }
    }

    // Stock from extension_attributes (this Magento returns stock_quantity as a number)
    const extAttrs = magentoProd.extension_attributes;
    let stockQty = 0;
    let isInStock = false;
    if (extAttrs?.stock_quantity !== undefined) {
      stockQty = Math.floor(extAttrs.stock_quantity);
      isInStock = stockQty > 0;
    } else if (extAttrs?.stock_item) {
      stockQty = Math.floor(extAttrs.stock_item.qty);
      isInStock = extAttrs.stock_item.is_in_stock;
    }

    // Weight
    const weight = magentoProd.weight || null;

    // Status: 1=enabled, 2=disabled
    const isActive = magentoProd.status === 1;

    if (product) {
      // Update existing product
      product.sku = magentoProd.sku;
      product.name = magentoProd.name;
      product.description = description;
      product.shortDescription = shortDescription;
      product.price = price;
      product.specialPrice = specialPrice;
      product.specialPriceFrom = specialPriceFrom ? new Date(specialPriceFrom) : null;
      product.specialPriceTo = specialPriceTo ? new Date(specialPriceTo) : null;
      product.weight = weight;
      product.productType = productType;
      product.imageUrl = imageUrl;
      product.thumbnailUrl = thumbnailUrl;
      product.isInStock = isInStock;
      product.stockQty = stockQty;
      product.brand = brand;
      product.isActive = isActive;
      product.syncedAt = new Date();
    } else {
      // Create new product
      product = this.productRepository.create({
        magentoId: magentoProd.id,
        sku: magentoProd.sku,
        name: magentoProd.name,
        description,
        shortDescription,
        price,
        specialPrice,
        specialPriceFrom: specialPriceFrom ? new Date(specialPriceFrom) : null,
        specialPriceTo: specialPriceTo ? new Date(specialPriceTo) : null,
        weight,
        productType,
        imageUrl,
        thumbnailUrl,
        isInStock,
        stockQty,
        brand,
        isActive,
        syncedAt: new Date(),
      });
    }

    // Handle categories from extension_attributes.category_links
    const categoryLinks = magentoProd.extension_attributes?.category_links;
    if (categoryLinks && categoryLinks.length > 0) {
      const categories: Category[] = [];
      for (const link of categoryLinks) {
        const category = await this.categoryRepository.findOne({
          where: { magentoId: parseInt(link.category_id, 10) },
        });
        if (category) {
          categories.push(category);
        }
      }
      product.categories = categories;
    }

    return this.productRepository.save(product);
  }

  private mapProductType(magentoType: string): ProductType {
    switch (magentoType) {
      case 'configurable':
        return ProductType.CONFIGURABLE;
      case 'bundle':
        return ProductType.BUNDLE;
      case 'grouped':
        return ProductType.GROUPED;
      case 'virtual':
        return ProductType.VIRTUAL;
      default:
        return ProductType.SIMPLE;
    }
  }

  async syncCustomers(): Promise<SyncResult> {
    this.logger.log('Starting customer sync...');
    this.progressStart('customers', 'Fetching customers from Magento…');
    const errors: string[] = [];
    let customersCreated = 0;
    let customersUpdated = 0;

    try {
      const magentoCustomers = await this.magentoService.fetchAllCustomers();
      this.progressPhase('Saving customers to POS', magentoCustomers.length);

      for (const magentoCust of magentoCustomers) {
        this.progressTick();
        try {
          await this.syncSingleCustomer(magentoCust);

          const existing = await this.customerRepository.findOne({
            where: { magentoId: magentoCust.id },
          });

          if (existing && existing.createdAt.getTime() === existing.updatedAt.getTime()) {
            customersCreated++;
          } else {
            customersUpdated++;
          }
        } catch (error) {
          const errorMsg = `Failed to sync customer ${magentoCust.email}: ${error}`;
          this.logger.error(errorMsg);
          errors.push(errorMsg);
        }
      }

      // Log the sync
      await this.logSync('customers', customersCreated + customersUpdated, errors.length === 0);

      const message = `Customer sync completed: ${customersCreated} created, ${customersUpdated} updated`;
      this.progressEnd(errors.length === 0, message);
      return {
        success: errors.length === 0,
        message,
        customersCreated,
        customersUpdated,
        errors: errors.length > 0 ? errors : undefined,
      };
    } catch (error) {
      this.logger.error('Customer sync failed', error);
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.progressEnd(false, message);
      return {
        success: false,
        message,
        errors: [String(error)],
      };
    }
  }

  private async syncSingleCustomer(magentoCust: MagentoCustomer): Promise<Customer> {
    let customer = await this.customerRepository.findOne({
      where: { magentoId: magentoCust.id },
    });

    // Extract billing address
    const billingAddr = magentoCust.addresses?.find(a => a.default_billing) || magentoCust.addresses?.[0];
    // Extract shipping address
    const shippingAddr = magentoCust.addresses?.find(a => a.default_shipping) || billingAddr;

    // Get phone from addresses (Magento stores phone on addresses, not customer)
    const phone = billingAddr?.telephone || shippingAddr?.telephone || null;

    // Get company from billing address
    const company = billingAddr?.company || null;

    // Get custom attribute for taxvat (ABN)
    const taxNumber = magentoCust.custom_attributes?.find(
      a => a.attribute_code === 'taxvat',
    )?.value || null;

    if (customer) {
      // Update existing customer
      customer.email = magentoCust.email;
      customer.firstName = magentoCust.firstname;
      customer.lastName = magentoCust.lastname;
      customer.phone = phone;
      customer.company = company;
      customer.taxNumber = taxNumber;

      // Update billing address
      if (billingAddr) {
        customer.billingStreet = billingAddr.street?.join(', ') || null;
        customer.billingCity = billingAddr.city || null;
        customer.billingState = billingAddr.region?.region_code || billingAddr.region?.region || null;
        customer.billingPostcode = billingAddr.postcode || null;
        customer.billingCountry = billingAddr.country_id || 'AU';
      }

      // Update shipping address
      if (shippingAddr) {
        customer.shippingStreet = shippingAddr.street?.join(', ') || null;
        customer.shippingCity = shippingAddr.city || null;
        customer.shippingState = shippingAddr.region?.region_code || shippingAddr.region?.region || null;
        customer.shippingPostcode = shippingAddr.postcode || null;
        customer.shippingCountry = shippingAddr.country_id || 'AU';
      }

      customer.syncStatus = SyncStatus.SYNCED;
      customer.syncedAt = new Date();
    } else {
      // Create new customer
      customer = this.customerRepository.create({
        magentoId: magentoCust.id,
        email: magentoCust.email,
        firstName: magentoCust.firstname,
        lastName: magentoCust.lastname,
        phone,
        company,
        taxNumber,
        billingStreet: billingAddr?.street?.join(', ') || null,
        billingCity: billingAddr?.city || null,
        billingState: billingAddr?.region?.region_code || billingAddr?.region?.region || null,
        billingPostcode: billingAddr?.postcode || null,
        billingCountry: billingAddr?.country_id || 'AU',
        shippingStreet: shippingAddr?.street?.join(', ') || null,
        shippingCity: shippingAddr?.city || null,
        shippingState: shippingAddr?.region?.region_code || shippingAddr?.region?.region || null,
        shippingPostcode: shippingAddr?.postcode || null,
        shippingCountry: shippingAddr?.country_id || 'AU',
        isGuest: false,
        syncStatus: SyncStatus.SYNCED,
        syncedAt: new Date(),
      });
    }

    return this.customerRepository.save(customer);
  }

  async fullSync(): Promise<SyncResult> {
    this.logger.log('Starting full sync...');

    // First sync categories
    const categoryResult = await this.syncCategories();
    if (!categoryResult.success) {
      return {
        success: false,
        message: `Category sync failed: ${categoryResult.message}`,
        errors: categoryResult.errors,
      };
    }

    // Then sync products
    const productResult = await this.syncProducts();

    // Then sync customers
    const customerResult = await this.syncCustomers();

    return {
      success: productResult.success && customerResult.success,
      message: `Full sync completed. Categories: ${categoryResult.categoriesCreated} created, ${categoryResult.categoriesUpdated} updated. Products: ${productResult.productsCreated} created, ${productResult.productsUpdated} updated. Customers: ${customerResult.customersCreated} created, ${customerResult.customersUpdated} updated.`,
      productsCreated: productResult.productsCreated,
      productsUpdated: productResult.productsUpdated,
      categoriesCreated: categoryResult.categoriesCreated,
      categoriesUpdated: categoryResult.categoriesUpdated,
      customersCreated: customerResult.customersCreated,
      customersUpdated: customerResult.customersUpdated,
      errors: [...(categoryResult.errors || []), ...(productResult.errors || []), ...(customerResult.errors || [])],
    };
  }

  // -----------------------------------------------------------------
  // POS → Magento order push
  // -----------------------------------------------------------------

  private readonly MAX_PUSH_ATTEMPTS = 3;

  /**
   * Push a single POS order to Magento via the admin cart flow.
   * Handles retries up to MAX_PUSH_ATTEMPTS with a short delay between each.
   * Updates the order's sync_status / sync_error / synced_at / magento_order_id.
   */
  async pushOrderToMagento(orderId: number): Promise<{ success: boolean; message: string }> {
    const order = await this.orderRepository.findOne({
      where: { id: orderId },
      relations: ['customer', 'items'],
    });
    if (!order) {
      return { success: false, message: `Order ${orderId} not found` };
    }

    // Only POS-origin orders need pushing; Magento-origin orders are already
    // in Magento (that's where they came from).
    if (order.source !== OrderSource.POS) {
      return { success: false, message: `Order ${orderId} is not a POS order` };
    }

    if (order.syncStatus === OrderSyncStatus.SYNCED) {
      return { success: true, message: `Order ${orderId} already synced` };
    }

    this.logger.log(`Pushing POS order ${order.orderNumber} to Magento...`);

    try {
      const magentoOrderId = await this.buildAndSendOrderToMagento(order);

      order.syncStatus = OrderSyncStatus.SYNCED;
      order.magentoOrderId = String(magentoOrderId);
      order.syncedAt = new Date();
      order.syncError = null;
      order.syncAttempts = (Number(order.syncAttempts) || 0) + 1;
      await this.orderRepository.save(order);

      this.logger.log(
        `Pushed order ${order.orderNumber} → Magento order ${magentoOrderId}`,
      );
      return { success: true, message: `Pushed to Magento order ${magentoOrderId}` };
    } catch (error: any) {
      const attempts = (Number(order.syncAttempts) || 0) + 1;
      const errorMsg = error?.response?.data?.message || error?.message || String(error);
      this.logger.error(
        `Push attempt ${attempts} for order ${order.orderNumber} failed: ${errorMsg}`,
      );

      order.syncAttempts = attempts;
      order.syncError = errorMsg.substring(0, 1000);
      order.syncStatus =
        attempts >= this.MAX_PUSH_ATTEMPTS
          ? OrderSyncStatus.FAILED
          : OrderSyncStatus.PENDING;
      await this.orderRepository.save(order);

      return { success: false, message: errorMsg };
    }
  }

  /**
   * Attempt to push a POS order, auto-retry up to MAX_PUSH_ATTEMPTS with
   * exponential backoff. Intended to be called fire-and-forget from the
   * order creation path so staff don't wait on Magento.
   */
  async pushOrderToMagentoWithRetry(orderId: number): Promise<void> {
    for (let attempt = 1; attempt <= this.MAX_PUSH_ATTEMPTS; attempt++) {
      const result = await this.pushOrderToMagento(orderId);
      if (result.success) return;

      // If the single push method already hit the final failure state,
      // stop retrying here — the caller can manually retry later.
      const order = await this.orderRepository.findOne({ where: { id: orderId } });
      if (!order || order.syncStatus === OrderSyncStatus.SYNCED) return;
      if (order.syncStatus === OrderSyncStatus.FAILED) return;

      // Exponential backoff: 2s, 6s, 18s
      const delay = 2000 * Math.pow(3, attempt - 1);
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  /**
   * The actual heavy lifting: creates a cart on Magento, adds each line item
   * by SKU, sets shipping info, places the order, and appends a comment with
   * POS metadata. Returns the new Magento order ID.
   */
  private async buildAndSendOrderToMagento(order: Order): Promise<number> {
    const isGuest = !order.customer || !order.customer.magentoId;

    // 1. Create a cart (admin-initiated for registered customer, guest otherwise)
    let cartId: number | string;
    if (isGuest) {
      cartId = await this.magentoService.adminCreateGuestCart();
    } else {
      cartId = await this.magentoService.adminCreateCustomerCart(
        order.customer!.magentoId!,
      );
    }

    // 2. Add each line item by SKU. Skip items without a productId (custom
    // items) — Magento has no SKU for them.
    let skippedCustomItems = 0;
    for (const item of order.items) {
      if (!item.productId) {
        skippedCustomItems++;
        continue;
      }
      if (!item.sku) {
        skippedCustomItems++;
        continue;
      }
      await this.magentoService.adminAddItemToCart(
        cartId,
        { sku: item.sku, qty: Number(item.quantity) },
        isGuest,
      );
    }

    // 3. Set shipping / billing information.
    // We use a minimal in-store pickup-style address. For guest orders,
    // fall back to the store's own address.
    const address = this.buildAddressForMagento(order);
    await this.magentoService.adminSetShippingInformation(
      cartId,
      {
        shipping_address: address,
        billing_address: address,
        shipping_method_code: 'flatrate',
        shipping_carrier_code: 'flatrate',
      },
      isGuest,
    );

    // 4. Place the order. paymentMethod "checkmo" is Magento's offline
    // "Check / Money Order" — used here as a generic in-store payment.
    // The real POS payment method is recorded in the order comment below.
    const email = isGuest
      ? 'walkin@auslighting.com.au'
      : order.customer!.email || 'walkin@auslighting.com.au';
    const magentoOrderId = await this.magentoService.adminPlaceOrder(
      cartId,
      'checkmo',
      isGuest,
      email,
    );

    // 5. Add a comment noting this came from the POS + skipped item count.
    const commentParts = [
      `Created from POS (${order.orderNumber})`,
      `Grand total: $${Number(order.grandTotal).toFixed(2)}`,
    ];
    if (skippedCustomItems > 0) {
      commentParts.push(
        `⚠ ${skippedCustomItems} custom item(s) were not synced to this Magento order`,
      );
    }
    await this.magentoService.adminAddOrderComment(
      magentoOrderId,
      commentParts.join(' | '),
    );

    return magentoOrderId;
  }

  /**
   * Build a Magento-compatible address payload from the customer, falling
   * back to the store address for walk-ins.
   */
  private buildAddressForMagento(order: Order): any {
    const storeFallback = {
      firstname: 'Walk-in',
      lastname: 'Customer',
      street: ['Australian Lighting & Fans'],
      city: 'Sydney',
      region: 'NSW',
      region_code: 'NSW',
      country_id: 'AU',
      postcode: '2000',
      telephone: '0000000000',
    };

    const c = order.customer;
    if (!c) return storeFallback;

    return {
      firstname: c.firstName || 'Walk-in',
      lastname: c.lastName || 'Customer',
      street: [c.billingStreet || 'Australian Lighting & Fans'],
      city: c.billingCity || 'Sydney',
      region: c.billingState || 'NSW',
      region_code: c.billingState || 'NSW',
      country_id: c.billingCountry || 'AU',
      postcode: c.billingPostcode || '2000',
      telephone: c.phone || c.mobile || '0000000000',
      email: c.email || undefined,
    };
  }

  /**
   * Batch: push every POS order that is still PENDING. Used by the
   * "Push Pending POS Orders" button in Settings.
   */
  async pushPendingPosOrders(): Promise<SyncResult> {
    const pending = await this.orderRepository.find({
      where: {
        source: OrderSource.POS,
        syncStatus: OrderSyncStatus.PENDING,
      },
      order: { createdAt: 'ASC' },
      take: 500,
    });

    let pushed = 0;
    const errors: string[] = [];

    for (const order of pending) {
      const result = await this.pushOrderToMagento(order.id);
      if (result.success) {
        pushed++;
      } else {
        errors.push(`${order.orderNumber}: ${result.message}`);
      }
      // Small delay to avoid hammering Magento
      await new Promise((r) => setTimeout(r, 200));
    }

    return {
      success: errors.length === 0,
      message: `Pushed ${pushed} of ${pending.length} pending POS orders`,
      errors: errors.length > 0 ? errors : undefined,
    };
  }

  async syncStockOnly(): Promise<SyncResult> {
    this.logger.log('Starting stock-only sync...');

    try {
      // Get all product SKUs from local database
      const products = await this.productRepository.find({
        select: ['sku'],
      });
      const skus = products.map((p) => p.sku);

      if (skus.length === 0) {
        return {
          success: true,
          message: 'No products to update',
          productsUpdated: 0,
        };
      }

      // Fetch stock from Magento
      const stockMap = await this.magentoService.fetchStockForSkus(skus);

      // Update stock quantities in database
      let updated = 0;
      for (const [sku, qty] of stockMap.entries()) {
        const result = await this.productRepository.update(
          { sku },
          { stockQty: Math.floor(qty), isInStock: qty > 0 },
        );
        if (result.affected && result.affected > 0) {
          updated++;
        }
      }

      this.logger.log(`Stock sync completed: ${updated} products updated`);

      return {
        success: true,
        message: `Stock sync completed: ${updated} products updated`,
        productsUpdated: updated,
      };
    } catch (error) {
      this.logger.error('Stock sync failed', error);
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  async syncOrders(): Promise<SyncResult> {
    if (this.orderSyncProgress.running) {
      return {
        success: false,
        message: 'An order sync is already in progress',
      };
    }

    this.logger.log('Starting order sync...');
    this.orderSyncProgress = {
      running: true,
      startedAt: new Date(),
      finishedAt: null,
      fetched: 0,
      processed: 0,
      created: 0,
      updated: 0,
      errors: 0,
      lastError: null,
      message: 'Fetching orders from Magento...',
    };

    const errors: string[] = [];
    let ordersCreated = 0;
    let ordersUpdated = 0;

    try {
      const magentoOrders = await this.magentoService.fetchAllOrders();
      this.orderSyncProgress.fetched = magentoOrders.length;
      this.orderSyncProgress.message = `Saving ${magentoOrders.length} orders to POS...`;

      for (const magentoOrder of magentoOrders) {
        try {
          const result = await this.syncSingleOrder(magentoOrder);
          if (result === 'created') {
            ordersCreated++;
            this.orderSyncProgress.created = ordersCreated;
          } else if (result === 'updated') {
            ordersUpdated++;
            this.orderSyncProgress.updated = ordersUpdated;
          }
        } catch (error) {
          const msg = `Failed to sync order ${magentoOrder.increment_id}: ${error}`;
          this.logger.error(msg);
          errors.push(msg);
          this.orderSyncProgress.errors++;
          this.orderSyncProgress.lastError = msg;
        }
        this.orderSyncProgress.processed++;
      }

      await this.logSync('orders', ordersCreated + ordersUpdated, errors.length === 0);

      this.orderSyncProgress.running = false;
      this.orderSyncProgress.finishedAt = new Date();
      this.orderSyncProgress.message = `Done: ${ordersCreated} created, ${ordersUpdated} updated, ${errors.length} errors`;

      return {
        success: errors.length === 0,
        message: `Order sync completed: ${ordersCreated} created, ${ordersUpdated} updated`,
        errors: errors.length > 0 ? errors : undefined,
      };
    } catch (error) {
      this.logger.error('Order sync failed', error);
      this.orderSyncProgress.running = false;
      this.orderSyncProgress.finishedAt = new Date();
      this.orderSyncProgress.lastError = String(error);
      this.orderSyncProgress.message = `Failed: ${error instanceof Error ? error.message : 'Unknown error'}`;
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Unknown error',
        errors: [String(error)],
      };
    }
  }

  private async syncSingleOrder(
    magentoOrder: MagentoOrder,
  ): Promise<'created' | 'updated'> {
    // Map Magento status → POS OrderStatus
    const statusMap: Record<string, OrderStatus> = {
      pending: OrderStatus.PENDING,
      processing: OrderStatus.PROCESSING,
      complete: OrderStatus.COMPLETE,
      closed: OrderStatus.COMPLETE,
      canceled: OrderStatus.CANCELLED,
      holded: OrderStatus.PENDING,
    };
    const status = statusMap[magentoOrder.status] || OrderStatus.PENDING;

    // Map payment status
    const paid = (magentoOrder.total_paid || 0) >= magentoOrder.grand_total;
    const paymentStatus = paid
      ? PaymentStatus.PAID
      : (magentoOrder.total_paid || 0) > 0
        ? PaymentStatus.PARTIAL
        : PaymentStatus.PENDING;

    // Link to existing POS customer via magentoId (if not guest)
    let customerId: number | null = null;
    if (magentoOrder.customer_id && !magentoOrder.customer_is_guest) {
      const customer = await this.customerRepository.findOne({
        where: { magentoId: magentoOrder.customer_id },
      });
      customerId = customer?.id || null;
    }

    // Find existing POS order by magentoOrderId
    let order = await this.orderRepository.findOne({
      where: { magentoOrderId: String(magentoOrder.entity_id) },
      relations: ['items'],
    });

    const isNew = !order;

    if (!order) {
      order = this.orderRepository.create({
        orderNumber: `M2-${magentoOrder.increment_id}`,
        magentoOrderId: String(magentoOrder.entity_id),
        magentoIncrementId: magentoOrder.increment_id,
        customerId,
        userId: 1, // system user — seeded admin
        subtotal: Number(magentoOrder.subtotal_incl_tax || magentoOrder.subtotal),
        discountAmount: Math.abs(Number(magentoOrder.discount_amount || 0)),
        taxAmount: Number(magentoOrder.tax_amount || 0),
        grandTotal: Number(magentoOrder.grand_total),
        taxRate: 0.1,
        status,
        paymentStatus,
        syncStatus: OrderSyncStatus.SYNCED,
        syncAttempts: 1,
        syncedAt: new Date(),
        source: OrderSource.MAGENTO,
        notes: magentoOrder.payment?.method ? `Magento payment: ${magentoOrder.payment.method}` : null,
      });
    } else {
      // Update status + totals (don't rewrite items — M2 is source of truth for existing orders)
      order.status = status;
      order.paymentStatus = paymentStatus;
      order.grandTotal = Number(magentoOrder.grand_total);
      order.customerId = customerId;
      order.source = OrderSource.MAGENTO;
      order.syncStatus = OrderSyncStatus.SYNCED;
      order.syncedAt = new Date();
    }

    const savedOrder = await this.orderRepository.save(order);

    // Override TypeORM's auto-managed created_at / updated_at with Magento's real timestamps.
    // @CreateDateColumn / @UpdateDateColumn ignore values passed via create(), so update directly.
    const magentoCreated = magentoOrder.created_at ? new Date(magentoOrder.created_at) : null;
    const magentoUpdated = magentoOrder.updated_at ? new Date(magentoOrder.updated_at) : null;
    if (magentoCreated || magentoUpdated) {
      await this.orderRepository
        .createQueryBuilder()
        .update(Order)
        .set({
          ...(magentoCreated ? { createdAt: magentoCreated } : {}),
          ...(magentoUpdated ? { updatedAt: magentoUpdated } : {}),
        })
        .where('id = :id', { id: savedOrder.id })
        .execute();
    }

    // Build line items only for new orders
    if (isNew && Array.isArray(magentoOrder.items)) {
      // Match local products by SKU when possible (Magento product_id ≠ POS product.id)
      for (const mItem of magentoOrder.items) {
        // Skip configurable parent rows — Magento returns both parent + child; keep the priced ones
        if (!mItem.price && !mItem.row_total) continue;

        const localProduct = await this.productRepository.findOne({
          where: { sku: mItem.sku },
        });

        const unitPrice = Number(mItem.price_incl_tax || mItem.price || 0);
        const quantity = Number(mItem.qty_ordered || 0);
        if (quantity <= 0) continue;

        const orderItem = this.orderItemRepository.create({
          orderId: savedOrder.id,
          productId: localProduct?.id ?? undefined,
          sku: mItem.sku,
          name: mItem.name,
          quantity,
          unitPrice,
          discountPercent: 0,
          discountAmount: Math.abs(Number(mItem.discount_amount || 0)),
          taxAmount: Number(mItem.tax_amount || 0),
          rowTotal: Number(mItem.row_total_incl_tax || mItem.row_total || 0),
        } as Partial<OrderItem>);
        await this.orderItemRepository.save(orderItem);
      }
    }

    return isNew ? 'created' : 'updated';
  }

  async clearAndSync(): Promise<SyncResult> {
    this.logger.log('Starting clear and sync...');

    // Clear existing data
    const clearResult = await this.clearDummyData();
    if (!clearResult.success) {
      return {
        success: false,
        message: `Failed to clear data: ${clearResult.message}`,
      };
    }

    // Full sync
    return this.fullSync();
  }

  private async logSync(entityType: 'products' | 'categories' | 'customers' | 'orders', recordsProcessed: number, success: boolean): Promise<void> {
    try {
      const syncTypeMap: Record<string, SyncType> = {
        products: SyncType.PRODUCTS,
        categories: SyncType.CATEGORIES,
        customers: SyncType.CUSTOMERS,
        orders: SyncType.ORDERS,
      };
      const syncType = syncTypeMap[entityType];
      const log = this.syncLogRepository.create({
        syncType,
        direction: SyncDirection.MAGENTO_TO_POS,
        status: success ? SyncLogStatus.COMPLETED : SyncLogStatus.FAILED,
        recordsProcessed,
        startedAt: new Date(),
        completedAt: new Date(),
      });
      await this.syncLogRepository.save(log);
    } catch (error) {
      this.logger.error('Failed to log sync', error);
    }
  }

  async getSyncStatus(): Promise<{
    lastSync: Date | null;
    productCount: number;
    categoryCount: number;
    customerCount: number;
  }> {
    const lastLog = await this.syncLogRepository.findOne({
      where: { status: SyncLogStatus.COMPLETED },
      order: { completedAt: 'DESC' },
    });

    const productCount = await this.productRepository.count();
    const categoryCount = await this.categoryRepository.count();
    const customerCount = await this.customerRepository.count();

    return {
      lastSync: lastLog?.completedAt || null,
      productCount,
      categoryCount,
      customerCount,
    };
  }
}
