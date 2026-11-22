import {
  SERVICE_CATALOG,
  ServiceIndex,
} from "@shepherdjerred/ops-model/catalog.ts";

import { DigestService } from "#application/ops-digest-service";
import { OpsService } from "#application/ops-service";
import { ReportService } from "#application/reports/report-service";
import type { Clock } from "#shared/time";
import {
  FixtureSeries,
  InMemoryOpsRepository,
  RecordingPostal,
} from "#test-fixtures/ops-memory";
import { MemoryReportRepository } from "#test-fixtures/reports-memory";

export type OpsFixture = {
  repository: InMemoryOpsRepository;
  reportsRepository: MemoryReportRepository;
  series: FixtureSeries;
  postal: RecordingPostal;
  ops: OpsService;
  digests: DigestService;
  reports: ReportService;
};

/** Ops, digest, and report services over in-memory adapters. */
export function createOpsFixture(
  clock: Clock,
  options: { mailer?: boolean; dailyDigestQuietClear?: boolean } = {},
): OpsFixture {
  const repository = new InMemoryOpsRepository();
  const reportsRepository = new MemoryReportRepository(repository);
  const series = new FixtureSeries();
  const postal = new RecordingPostal();
  const ops = new OpsService({
    repository,
    series,
    clock,
    services: new ServiceIndex(SERVICE_CATALOG),
    grafanaUids: { prometheus: "prometheus", loki: "loki", tempo: "tempo" },
  });
  const digests = new DigestService({
    repository,
    ops,
    series,
    mailer: options.mailer === false ? null : postal,
    clock,
    ...(options.dailyDigestQuietClear === undefined
      ? {}
      : { dailyDigestQuietClear: options.dailyDigestQuietClear }),
  });
  const reports = new ReportService({
    repository: reportsRepository,
    digests,
    clock,
  });
  return {
    repository,
    reportsRepository,
    series,
    postal,
    ops,
    digests,
    reports,
  };
}
