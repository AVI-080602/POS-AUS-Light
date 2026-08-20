import { DataSource } from 'typeorm';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

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

// Havit strip lighting range (Sally's "to put up" sheet, Aug 2026):
// 357 sellable variants (per-metre / roll x colour temperature) that
// don't exist in Magento yet, inserted directly so the store can sell
// them now. price = RRP inc GST, cost = supplier cost inc GST (per Avi,
// matching the Aug 2026 inc-GST cost basis).
//
// magento_id is NOT NULL + unique, so rows get sentinel ids from
// 9,000,000 up (real Magento entity ids are ~5 digits). When these
// products are eventually created in Magento, reconcile BEFORE the
// first product sync of those SKUs: the sync matches on magento_id and
// would hit the unique-sku constraint trying to re-create them —
// update each row's magento_id to the real Magento id by sku.
//
// Idempotent: rerunning updates name/price/cost by unique sku.
const SENTINEL_BASE = 9_000_000;

async function importHavitStrip() {
  const tsvPath = path.join(__dirname, 'data', 'havit-strip-products.tsv');
  const rows = fs
    .readFileSync(tsvPath, 'utf-8')
    .split('\n')
    .map((l) => l.replace(/\r$/, ''))
    .filter((l) => l.length > 0)
    .slice(1)
    .map((line) => {
      const [sku, name, price, cost] = line.split('\t');
      return { sku, name, price: parseFloat(price), cost: cost ? parseFloat(cost) : null };
    });

  console.log(`📄 ${rows.length} Havit strip variants loaded\n`);

  await dataSource.initialize();
  console.log(`✅ Connected to ${process.env.DB_DATABASE}@${process.env.DB_HOST}\n`);

  // Same batching rationale as import-cost-prices: bound row-lock time
  // on the live DB.
  const BATCH_SIZE = 100;
  const queryRunner = dataSource.createQueryRunner();
  await queryRunner.connect();

  let inserted = 0;
  let updated = 0;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    await queryRunner.startTransaction();
    try {
      for (let j = 0; j < batch.length; j++) {
        const { sku, name, price, cost } = batch[j];
        if (!sku || !name || !Number.isFinite(price)) continue;
        const result = await queryRunner.query(
          `INSERT INTO products
             (magento_id, sku, name, price, cost, stock_qty, is_in_stock,
              manage_stock, product_type, brand, is_active)
           VALUES (?, ?, ?, ?, ?, 0, 1, 0, 'simple', 'Havit', 1)
           ON DUPLICATE KEY UPDATE
             name = VALUES(name), price = VALUES(price), cost = VALUES(cost)`,
          [SENTINEL_BASE + i + j, sku, name, price, cost],
        );
        // mysql: affectedRows is 1 for insert, 2 for duplicate-update
        if (result.affectedRows === 1) inserted++;
        else updated++;
      }
      await queryRunner.commitTransaction();
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw err;
    }
    console.log(`  ...${Math.min(i + BATCH_SIZE, rows.length)}/${rows.length}`);
  }
  await queryRunner.release();

  console.log(`✅ Inserted: ${inserted}, updated existing: ${updated}`);
  await dataSource.destroy();
}

importHavitStrip()
  .then(() => {
    console.log('\n🎉 Havit strip import complete');
    process.exit(0);
  })
  .catch((err) => {
    console.error('❌ Havit strip import failed:', err);
    process.exit(1);
  });
