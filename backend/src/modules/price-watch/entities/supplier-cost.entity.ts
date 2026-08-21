import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
  UpdateDateColumn,
} from 'typeorm';

// One row per (supplier sheet, sku) from the 29 supplier cost lists —
// the base population the weekly competitor scrape prices against.
// Loaded/refreshed by the import:supplier-costs seed.
@Entity('supplier_costs')
@Index(['supplier', 'sku'], { unique: true })
export class SupplierCost {
  @PrimaryGeneratedColumn({ unsigned: true })
  id: number;

  @Column({ type: 'varchar', length: 100 })
  supplier: string;

  @Index()
  @Column({ type: 'varchar', length: 100 })
  sku: string;

  @Column({ name: 'cost_ex_gst', type: 'decimal', precision: 12, scale: 4, nullable: true })
  costExGst: number | null;

  @Column({ name: 'cost_inc_gst', type: 'decimal', precision: 12, scale: 4 })
  costIncGst: number;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
