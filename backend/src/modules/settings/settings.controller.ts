import {
  Controller,
  Get,
  Put,
  Body,
  Param,
  UseGuards,
  Request,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { SettingsService } from './settings.service';
import {
  UpdateSettingDto,
  UpdateMultipleSettingsDto,
  UpdateStoreSettingsDto,
  UpdatePaymentSettingsDto,
  UpdateRoleDto,
} from './dto/update-setting.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles, RoleNames } from '../auth/decorators/roles.decorator';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Role } from '../users/entities/role.entity';
import { SettingType } from './entities/setting.entity';
import {
  DEFAULT_STRIP_PRODUCTS,
  normaliseStripProducts,
} from './led-strip.defaults';

@ApiTags('settings')
@Controller('settings')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class SettingsController {
  constructor(
    private readonly settingsService: SettingsService,
    @InjectRepository(Role)
    private readonly roleRepository: Repository<Role>,
  ) {}

  @Get()
  @Roles(RoleNames.ADMIN)
  @ApiOperation({ summary: 'Get all settings' })
  async findAll() {
    const settings = await this.settingsService.findAll();
    return {
      success: true,
      data: {
        settings: settings.map((s) => ({
          key: s.settingKey,
          value: s.getValue(),
          type: s.settingType,
          description: s.description,
          updatedAt: s.updatedAt,
        })),
      },
    };
  }

  @Get('store')
  @Roles(RoleNames.ADMIN)
  @ApiOperation({ summary: 'Get store settings' })
  async getStoreSettings() {
    const settings = await this.settingsService.getStoreSettings();
    return {
      success: true,
      data: settings,
    };
  }

  @Put('store')
  @Roles(RoleNames.ADMIN)
  @ApiOperation({ summary: 'Update store settings' })
  async updateStoreSettings(
    @Body() dto: UpdateStoreSettingsDto,
    @Request() req: any,
  ) {
    const userId = req.user?.id;
    const updates: Array<{ key: string; value: any; type?: SettingType }> = [];

    if (dto.store_name !== undefined) {
      updates.push({ key: 'store_name', value: dto.store_name });
    }
    if (dto.store_abn !== undefined) {
      updates.push({ key: 'store_abn', value: dto.store_abn });
    }
    if (dto.store_address !== undefined) {
      updates.push({ key: 'store_address', value: dto.store_address });
    }
    if (dto.store_phone !== undefined) {
      updates.push({ key: 'store_phone', value: dto.store_phone });
    }
    if (dto.store_email !== undefined) {
      updates.push({ key: 'store_email', value: dto.store_email });
    }
    if (dto.tax_rate !== undefined) {
      updates.push({ key: 'tax_rate', value: dto.tax_rate, type: SettingType.NUMBER });
    }
    if (dto.quote_expiry_days !== undefined) {
      updates.push({ key: 'quote_expiry_days', value: dto.quote_expiry_days, type: SettingType.NUMBER });
    }
    if (dto.trading_hours !== undefined) {
      updates.push({ key: 'trading_hours', value: dto.trading_hours, type: SettingType.JSON });
    }

    await this.settingsService.updateMultiple(updates, userId);
    const settings = await this.settingsService.getStoreSettings();

    return {
      success: true,
      message: 'Store settings updated successfully',
      data: settings,
    };
  }

  @Get('payments')
  @Roles(RoleNames.ADMIN)
  @ApiOperation({ summary: 'Get payment settings' })
  async getPaymentSettings() {
    const settings = await this.settingsService.getPaymentSettings();

    // Set defaults if not exists
    return {
      success: true,
      data: {
        payment_cash_enabled: settings.payment_cash_enabled ?? true,
        payment_eftpos_enabled: settings.payment_eftpos_enabled ?? true,
        payment_credit_card_enabled: settings.payment_credit_card_enabled ?? true,
        payment_store_credit_enabled: settings.payment_store_credit_enabled ?? true,
        default_payment_method: settings.default_payment_method ?? 'cash',
      },
    };
  }

  @Put('payments')
  @Roles(RoleNames.ADMIN)
  @ApiOperation({ summary: 'Update payment settings' })
  async updatePaymentSettings(
    @Body() dto: UpdatePaymentSettingsDto,
    @Request() req: any,
  ) {
    const userId = req.user?.id;
    const updates: Array<{ key: string; value: any; type?: SettingType }> = [];

    if (dto.payment_cash_enabled !== undefined) {
      updates.push({ key: 'payment_cash_enabled', value: dto.payment_cash_enabled, type: SettingType.BOOLEAN });
    }
    if (dto.payment_eftpos_enabled !== undefined) {
      updates.push({ key: 'payment_eftpos_enabled', value: dto.payment_eftpos_enabled, type: SettingType.BOOLEAN });
    }
    if (dto.payment_credit_card_enabled !== undefined) {
      updates.push({ key: 'payment_credit_card_enabled', value: dto.payment_credit_card_enabled, type: SettingType.BOOLEAN });
    }
    if (dto.payment_store_credit_enabled !== undefined) {
      updates.push({ key: 'payment_store_credit_enabled', value: dto.payment_store_credit_enabled, type: SettingType.BOOLEAN });
    }
    if (dto.default_payment_method !== undefined) {
      updates.push({ key: 'default_payment_method', value: dto.default_payment_method });
    }

    await this.settingsService.updateMultiple(updates, userId);

    return {
      success: true,
      message: 'Payment settings updated successfully',
    };
  }

  @Get('roles')
  @Roles(RoleNames.ADMIN)
  @ApiOperation({ summary: 'Get all roles with discount settings' })
  async getRoles() {
    const roles = await this.roleRepository.find({
      order: { id: 'ASC' },
    });

    return {
      success: true,
      data: {
        roles: roles.map((role) => ({
          id: role.id,
          name: role.name,
          displayName: role.displayName,
          maxDiscountPercent: parseFloat(String(role.maxDiscountPercent)),
          canStackDiscounts: role.canStackDiscounts,
        })),
      },
    };
  }

  @Put('roles/:id')
  @Roles(RoleNames.ADMIN)
  @ApiOperation({ summary: 'Update role settings' })
  async updateRole(
    @Param('id') id: number,
    @Body() dto: UpdateRoleDto,
  ) {
    const role = await this.roleRepository.findOne({ where: { id } });
    if (!role) {
      return {
        success: false,
        error: { message: 'Role not found' },
      };
    }

    if (dto.displayName !== undefined) {
      role.displayName = dto.displayName;
    }
    if (dto.maxDiscountPercent !== undefined) {
      role.maxDiscountPercent = dto.maxDiscountPercent;
    }
    if (dto.canStackDiscounts !== undefined) {
      role.canStackDiscounts = dto.canStackDiscounts;
    }

    await this.roleRepository.save(role);

    return {
      success: true,
      message: 'Role updated successfully',
      data: {
        role: {
          id: role.id,
          name: role.name,
          displayName: role.displayName,
          maxDiscountPercent: parseFloat(String(role.maxDiscountPercent)),
          canStackDiscounts: role.canStackDiscounts,
        },
      },
    };
  }

  @Get('system')
  @Roles(RoleNames.ADMIN)
  @ApiOperation({ summary: 'Get system settings' })
  async getSystemSettings() {
    const settings = await this.settingsService.getSystemSettings();
    return {
      success: true,
      data: {
        receipt_print_enabled: settings.receipt_print_enabled ?? true,
        receipt_logo_url: settings.receipt_logo_url ?? '',
        receipt_footer_text: settings.receipt_footer_text ?? 'Thank you for shopping with us!',
        default_stock_hold: settings.default_stock_hold ?? false,
        offline_mode_enabled: settings.offline_mode_enabled ?? false,
      },
    };
  }

  @Put('system')
  @Roles(RoleNames.ADMIN)
  @ApiOperation({ summary: 'Update system settings' })
  async updateSystemSettings(
    @Body() dto: any,
    @Request() req: any,
  ) {
    const userId = req.user?.id;
    const updates: Array<{ key: string; value: any; type?: SettingType }> = [];

    if (dto.receipt_print_enabled !== undefined) {
      updates.push({ key: 'receipt_print_enabled', value: dto.receipt_print_enabled, type: SettingType.BOOLEAN });
    }
    if (dto.receipt_logo_url !== undefined) {
      updates.push({ key: 'receipt_logo_url', value: dto.receipt_logo_url });
    }
    if (dto.receipt_footer_text !== undefined) {
      updates.push({ key: 'receipt_footer_text', value: dto.receipt_footer_text });
    }
    if (dto.default_stock_hold !== undefined) {
      updates.push({ key: 'default_stock_hold', value: dto.default_stock_hold, type: SettingType.BOOLEAN });
    }
    if (dto.offline_mode_enabled !== undefined) {
      updates.push({ key: 'offline_mode_enabled', value: dto.offline_mode_enabled, type: SettingType.BOOLEAN });
    }

    await this.settingsService.updateMultiple(updates, userId);

    return {
      success: true,
      message: 'System settings updated successfully',
    };
  }

  // Cut-to-length LED strip rates. Readable by any signed-in staff
  // member (the Strip Cut Counter needs them), editable by admins only.
  // NOTE: must be declared before the @Put(':key') catch-all below.
  @Get('led-strip')
  @ApiOperation({ summary: 'Get the LED strip cut-to-length catalogue' })
  async getLedStripProducts() {
    const stored = await this.settingsService.getValue<any>(
      'led_strip_products',
      null,
    );
    return {
      success: true,
      data: { products: normaliseStripProducts(stored) },
    };
  }

  @Put('led-strip')
  @Roles(RoleNames.ADMIN)
  @ApiOperation({ summary: 'Update the LED strip cut-to-length catalogue' })
  async updateLedStripProducts(
    @Body() dto: { products?: unknown },
    @Request() req: any,
  ) {
    // Normalise before persisting so a bad payload can't poison the
    // calculator for every till.
    const products = normaliseStripProducts(dto?.products);
    await this.settingsService.set(
      'led_strip_products',
      products,
      SettingType.JSON,
      'Cut-to-length LED strip rates (per metre, GST inclusive)',
      req.user?.id,
    );
    return {
      success: true,
      message: 'LED strip pricing updated successfully',
      data: { products },
    };
  }

  @Get('led-strip/defaults')
  @Roles(RoleNames.ADMIN)
  @ApiOperation({ summary: 'Get the built-in LED strip catalogue (for reset)' })
  getLedStripDefaults() {
    return {
      success: true,
      data: { products: DEFAULT_STRIP_PRODUCTS },
    };
  }

  @Put(':key')
  @Roles(RoleNames.ADMIN)
  @ApiOperation({ summary: 'Update a single setting' })
  async updateSetting(
    @Param('key') key: string,
    @Body() dto: UpdateSettingDto,
    @Request() req: any,
  ) {
    const userId = req.user?.id;
    await this.settingsService.set(
      key,
      dto.value,
      dto.type ?? SettingType.STRING,
      dto.description,
      userId,
    );

    return {
      success: true,
      message: `Setting '${key}' updated successfully`,
    };
  }
}
