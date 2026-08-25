import type { ExtendedPrismaClient } from "#src/database/index.ts";
import type { ReportLakeStagingTable } from "#src/report-lake/staging.ts";

export type ReportLakeProgress = {
  phase: string;
  table?: ReportLakeStagingTable;
  files?: number;
  rows?: number;
  skipped?: number;
};

export type CompactionOptions = {
  prisma?: ExtendedPrismaClient;
  lakeDir?: string;
  onProgress?: (progress: ReportLakeProgress) => void;
};
