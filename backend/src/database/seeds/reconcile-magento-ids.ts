import { DataSource } from 'typeorm';
import axios from 'axios';
import * as fs from 'fs';
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

// Heals products whose POS magento_id no longer matches Magento, so the
// product sync (which matches by magento_id) stops hitting
// "Duplicate entry ... for key products.IDX_..." on their skus:
//   1. every direct-inserted row with a sentinel id (>= 9,000,000 — the
//      Havit strip batch) — they collide as soon as the same skus are
//      created in Magento;
//   2. optionally, skus listed in a file passed as the first arg (one
//      per line — e.g. /root/dup_skus.txt collected from the sync logs)
//      — covers products deleted + re-created in Magento with new ids.
// For each, we look the sku up in Magento and adopt its current id.
// Skus not in Magento yet are skipped (retry after they're created).
// Idempotent: rows already carrying the right id are left alone.
const SENTINEL_BASE = 9_000_000;

async function magentoToken(base: string): Promise<string> {
  const r = await axios.post(
    `${base}/rest/V1/integration/admin/token`,
    {
      username: process.env.MAGENTO_ADMIN_USERNAME,
      password: process.env.MAGENTO_ADMIN_PASSWORD,
    },
    { headers: { 'Content-Type': 'application/json' }, timeout: 30000 },
  );
  return r.data;
}

async function reconcile() {
  const base = (process.env.MAGENTO_BASE_URL || '').replace(/\/$/, '');
  if (!base) throw new Error('MAGENTO_BASE_URL not set');

  await dataSource.initialize();
  console.log(`✅ Connected to ${process.env.DB_DATABASE}@${process.env.DB_HOST}`);
  const token = await magentoToken(base);
  console.log('✅ Magento token acquired');

  const targets = new Map<string, { id: number; magentoId: number }>();
  const rows: Array<{ id: number; sku: string; magento_id: number }> =
    await dataSource.query(
      'SELECT id, sku, magento_id FROM products WHERE magento_id >= ?',
      [SENTINEL_BASE],
    );
  for (const r of rows) targets.set(r.sku, { id: r.id, magentoId: r.magento_id });
  console.log(`${rows.length} sentinel-id rows (direct inserts)`);

  const listFile = process.argv[2];
  if (listFile && fs.existsSync(listFile)) {
    const skus = fs
      .readFileSync(listFile, 'utf-8')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    let added = 0;
    for (const sku of skus) {
      if (targets.has(sku)) continue;
      const found: any[] = await dataSource.query(
        'SELECT id, magento_id FROM products WHERE sku = ?',
        [sku],
      );
      if (found.length === 1) {
        targets.set(sku, { id: found[0].id, magentoId: found[0].magento_id });
        added++;
      }
    }
    console.log(`${added} more from ${listFile}`);
  }

  let fixed = 0;
  let notInMagento = 0;
  let alreadyOk = 0;
  let failed = 0;
  for (const [sku, row] of targets) {
    try {
      const r = await axios.get(
        `${base}/rest/V1/products/${encodeURIComponent(sku)}`,
        {
          headers: { Authorization: `Bearer ${token}` },
          timeout: 30000,
          validateStatus: (s) => s === 200 || s === 404,
        },
      );
      if (r.status === 404) {
        notInMagento++;
        continue;
      }
      const realId = r.data?.id;
      if (!Number.isInteger(realId) || realId <= 0) {
        failed++;
        console.log(`  ? ${sku}: Magento returned no id`);
        continue;
      }
      if (realId === row.magentoId) {
        alreadyOk++;
        continue;
      }
      // If some other row already claims that magento_id (stale copy of
      // a deleted product), park it out of the way first — a plain
      // update would hit the unique index.
      const clash: any[] = await dataSource.query(
        'SELECT id, sku FROM products WHERE magento_id = ? AND id != ?',
        [realId, row.id],
      );
      if (clash.length > 0) {
        console.log(
          `  ! ${sku}: magento_id ${realId} already on row for sku ${clash[0].sku} — skipping, needs a human look`,
        );
        failed++;
        continue;
      }
      await dataSource.query('UPDATE products SET magento_id = ? WHERE id = ?', [
        realId,
        row.id,
      ]);
      fixed++;
      if (fixed % 50 === 0) console.log(`  ...${fixed} fixed`);
    } catch (err: any) {
      failed++;
      console.log(`  ✗ ${sku}: ${err?.message}`);
    }
  }

  console.log(
    `\n✅ Reconciled: ${fixed} fixed, ${alreadyOk} already correct, ` +
      `${notInMagento} not in Magento yet (retry later), ${failed} need attention`,
  );
  console.log('Now re-run the product sync — the duplicate-sku errors for fixed rows are gone.');
  await dataSource.destroy();
}

reconcile()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ Reconcile failed:', err?.message || err);
    process.exit(1);
  });
