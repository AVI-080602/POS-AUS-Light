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

// Load supplier-costs.tsv (one row per supplier sheet x sku, from the
// 29 cost lists in fwcostpricescomplete) into the supplier_costs table
// that feeds the competitor price dashboard. Idempotent: upserts by
// (supplier, sku). Costs are GST-inclusive in cost_inc_gst; ex-GST kept
// alongside where the sheet had it.
async function importSupplierCosts() {
  const tsvPath = path.join(__dirname, 'data', 'supplier-costs.tsv');
  const rows = fs
    .readFileSync(tsvPath, 'utf-8')
    .split('\n')
    .map((l) => l.replace(/\r$/, ''))
    .filter((l) => l.length > 0)
    .slice(1)
    .map((line) => {
      const [supplier, sku, ex, inc] = line.split('\t');
      return {
        supplier,
        sku,
        ex: ex ? parseFloat(ex) : null,
        inc: parseFloat(inc),
      };
    });

  console.log(`📄 ${rows.length} supplier/sku cost rows loaded\n`);

  await dataSource.initialize();
  console.log(`✅ Connected to ${process.env.DB_DATABASE}@${process.env.DB_HOST}\n`);

  const BATCH_SIZE = 500;
  const queryRunner = dataSource.createQueryRunner();
  await queryRunner.connect();

  let done = 0;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    await queryRunner.startTransaction();
    try {
      for (const { supplier, sku, ex, inc } of batch) {
        if (!supplier || !sku || !Number.isFinite(inc)) continue;
        await queryRunner.query(
          `INSERT INTO supplier_costs (supplier, sku, cost_ex_gst, cost_inc_gst)
           VALUES (?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             cost_ex_gst = VALUES(cost_ex_gst), cost_inc_gst = VALUES(cost_inc_gst)`,
          [supplier, sku, ex, inc],
        );
        done++;
      }
      await queryRunner.commitTransaction();
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw err;
    }
    console.log(`  ...${Math.min(i + BATCH_SIZE, rows.length)}/${rows.length}`);
  }
  await queryRunner.release();

  console.log(`✅ Upserted: ${done}`);
  await dataSource.destroy();
}

importSupplierCosts()
  .then(() => {
    console.log('\n🎉 Supplier cost import complete');
    process.exit(0);
  })
  .catch((err) => {
    console.error('❌ Supplier cost import failed:', err);
    process.exit(1);
  });
