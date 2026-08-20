import { DataSource } from 'typeorm';
import * as dotenv from 'dotenv';
import { DEFAULT_STRIP_PRODUCTS } from '../../modules/settings/led-strip.defaults';

dotenv.config();

const dataSource = new DataSource({
  type: 'mysql',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '3306', 10),
  username: process.env.DB_USERNAME || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_DATABASE || 'pos_aus_light',
  synchronize: false,
  logging: false,
});

// Push the Havit per-metre strip catalogue (led-strip.defaults.ts, from
// Sally's Aug 2026 strip sheet) into the live `led_strip_products`
// setting, replacing the original 4 generic strips in the Strip Cut
// Counter. Idempotent — reruns overwrite the setting with the same list.
// Rates stay admin-editable under Settings → LED Strip afterwards.
async function importLedStripSetting() {
  await dataSource.initialize();
  console.log(`✅ Connected to ${process.env.DB_DATABASE}@${process.env.DB_HOST}`);

  const json = JSON.stringify(DEFAULT_STRIP_PRODUCTS);
  await dataSource.query(
    `INSERT INTO settings (setting_key, setting_value, setting_type, description)
     VALUES ('led_strip_products', ?, 'json', 'Cut-to-length LED strip rates (per metre, GST inclusive)')
     ON DUPLICATE KEY UPDATE
       setting_value = VALUES(setting_value),
       setting_type = VALUES(setting_type),
       description = VALUES(description)`,
    [json],
  );

  console.log(`✅ led_strip_products set: ${DEFAULT_STRIP_PRODUCTS.length} strip products`);
  await dataSource.destroy();
}

importLedStripSetting()
  .then(() => {
    console.log('\n🎉 LED strip catalogue updated');
    process.exit(0);
  })
  .catch((err) => {
    console.error('❌ LED strip setting import failed:', err);
    process.exit(1);
  });
