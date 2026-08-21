import { Entity, PrimaryGeneratedColumn, Column, Index } from 'typeorm';

// Snapshot of one competitor's price for one sku in one scrape run.
// History is kept run over run — movement columns diff the latest two.
@Entity('competitor_price_snapshots')
@Index(['runId', 'sku'])
@Index(['runId', 'competitor'])
export class CompetitorPriceSnapshot {
  @PrimaryGeneratedColumn({ unsigned: true })
  id: number;

  @Column({ name: 'run_id', type: 'int', unsigned: true })
  runId: number;

  @Column({ type: 'varchar', length: 100 })
  sku: string;

  @Column({ type: 'varchar', length: 50 })
  competitor: string;

  @Column({ type: 'decimal', precision: 12, scale: 2 })
  price: number;

  @Column({ type: 'varchar', length: 500, nullable: true })
  url: string | null;
}
