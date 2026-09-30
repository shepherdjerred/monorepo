import {
  SERVICE_CATALOG,
  ServiceIndex,
} from "@shepherdjerred/ops-model/catalog.ts";

import { DigestService } from "#application/ops-digest-service";
import { OpsService } from "#application/ops-service";
import type { Clock } from "#shared/time";
import {
  FixtureSeries,
  InMemoryOpsRepository,
  RecordingPostal,
} from "#test-fixtures/ops-memory";

export type OpsFixture = {
  repository: InMemoryOpsRepository;
  series: FixtureSeries;
  postal: RecordingPostal;
  gate: { enabled: boolean };
  ops: OpsService;
  digests: DigestService;
};

/** Ops and digest services over in-memory adapters. */
export function createOpsFixture(
  clock: Clock,
  options: { digestEnabled?: boolean; mailer?: boolean } = {},
): OpsFixture {
  const repository = new InMemoryOpsRepository();
  const series = new FixtureSeries();
  const postal = new RecordingPostal();
  const gate = { enabled: options.digestEnabled ?? false };
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
    gate: { digestEmailEnabled: () => Promise.resolve(gate.enabled) },
    mailer: options.mailer === false ? null : postal,
    clock,
  });
  return { repository, series, postal, gate, ops, digests };
}
