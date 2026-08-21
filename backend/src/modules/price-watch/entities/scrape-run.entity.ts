import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

export enum ScrapeRunStatus {
  RUNNING = 'running',
  DONE = 'done',
  FAILED = 'failed',
}

// One row per weekly competitor scrape (plus any manual admin runs).
@Entity('scrape_runs')
export class ScrapeRun {
  @PrimaryGeneratedColumn({ unsigned: true })
  id: number;

  @CreateDateColumn({ name: 'started_at' })
  startedAt: Date;

  @Column({ name: 'finished_at', type: 'timestamp', nullable: true })
  finishedAt: Date | null;

  @Column({ type: 'enum', enum: ScrapeRunStatus, default: ScrapeRunStatus.RUNNING })
  status: ScrapeRunStatus;

  // JSON: { perCompetitor: { onlinelighting: 4102, ... }, totalPrices, durationS }
  @Column({ type: 'text', nullable: true })
  stats: string | null;

  @Column({ type: 'text', nullable: true })
  error: string | null;
}
