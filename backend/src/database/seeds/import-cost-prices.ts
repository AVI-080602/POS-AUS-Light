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

// One-time import of supplier cost prices from ALF_CostPrice_Comparison.xlsx
// (exact-SKU-matched rows only). Re-running is safe/idempotent — it just
// overwrites `cost` for the SKUs in the CSV.
async function importCostPrices() {
  const csvPath = path.join(__dirname, 'data', 'alf-cost-prices.csv');
  const rows = fs
    .readFileSync(csvPath, 'utf-8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .slice(1) // header
    .map((line) => {
      const idx = line.lastIndexOf(',');
      return { sku: line.slice(0, idx), cost: parseFloat(line.slice(idx + 1)) };
    });

  console.log(`📄 ${rows.length} SKU/cost rows loaded from ${csvPath}\n`);

  await dataSource.initialize();
  console.log(`✅ Connected to ${process.env.DB_DATABASE}@${process.env.DB_HOST}\n`);

  // Commit in small batches rather than one transaction for all 6,777
  // rows — this is a live production database taking concurrent orders,
  // and a single long-running transaction holds row locks on every
  // touched product until final commit, which can starve/timeout other
  // queries (an order-creation request hit exactly this: "Lock wait
  // timeout exceeded"). Batching bounds how long any given row stays
  // locked to roughly one batch's worth of statements.
  const BATCH_SIZE = 200;
  const queryRunner = dataSource.createQueryRunner();
  await queryRunner.connect();

  let updated = 0;
  const notFound: string[] = [];

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    await queryRunner.startTransaction();
    try {
      for (const { sku, cost } of batch) {
        if (!sku || !Number.isFinite(cost)) continue;
        const result = await queryRunner.query(
          'UPDATE products SET cost = ? WHERE sku = ?',
          [cost, sku],
        );
        if (result.affectedRows > 0) {
          updated++;
        } else {
          notFound.push(sku);
        }
      }
      await queryRunner.commitTransaction();
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw err;
    }
    console.log(`  ...${Math.min(i + BATCH_SIZE, rows.length)}/${rows.length}`);
  }
  await queryRunner.release();

  console.log(`✅ Updated: ${updated}`);
  console.log(`⚠️  Not found in products table: ${notFound.length}`);
  if (notFound.length > 0) {
    console.log(notFound.slice(0, 20).join(', ') + (notFound.length > 20 ? ', ...' : ''));
  }

  await dataSource.destroy();
}

importCostPrices()
  .then(() => {
    console.log('\n🎉 Cost import complete');
    process.exit(0);
  })
  .catch((err) => {
    console.error('❌ Cost import failed:', err);
    process.exit(1);
  });
