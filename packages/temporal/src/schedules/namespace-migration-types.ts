import type { Client, ScheduleDescription } from "@temporalio/client";
import type { TemporalNamespace } from "#shared/temporal-namespace.ts";

export type MigrationTargetNamespace = Exclude<TemporalNamespace, "dev">;

export type MigrationSchedule = {
  source: ScheduleDescription;
  targetNamespace: MigrationTargetNamespace;
};

export type NamespaceMigrationAuditInput = {
  sourceClient: Client;
  schedules: readonly MigrationSchedule[];
  targetClients: ReadonlyMap<MigrationTargetNamespace, Client>;
  cutoverAt: Date;
};
