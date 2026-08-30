import type { Client, ScheduleDescription } from "@temporalio/client";
import {
  decodeMigrationState,
  migrationAuditQueries,
} from "./namespace-migration-state.ts";
import type {
  MigrationSchedule,
  MigrationTargetNamespace,
} from "./namespace-migration.ts";

export type NamespaceMigrationAuditInput = {
  sourceClient: Client;
  schedules: readonly MigrationSchedule[];
  targetClients: ReadonlyMap<MigrationTargetNamespace, Client>;
  cutoverAt: Date;
};

type AuditDependencies = {
  targetClient: (
    clients: ReadonlyMap<MigrationTargetNamespace, Client>,
    namespace: MigrationTargetNamespace,
  ) => Client;
  comparableSchedule: (description: ScheduleDescription) => string;
  isRootWorkflowExecution: (execution: {
    runId: string;
    rootExecution?: { runId: string | null } | null;
  }) => boolean;
};

export async function auditNamespaceMigration(
  input: NamespaceMigrationAuditInput,
  dependencies: AuditDependencies,
): Promise<void> {
  for (const migration of input.schedules) {
    const source = await input.sourceClient.schedule
      .getHandle(migration.source.scheduleId)
      .describe();
    if (!source.state.paused) {
      throw new Error(`Source default/${source.scheduleId} is active`);
    }
    const target = dependencies
      .targetClient(input.targetClients, migration.targetNamespace)
      .schedule.getHandle(source.scheduleId);
    const targetDescription = await target.describe();
    if (
      dependencies.comparableSchedule(source) !==
      dependencies.comparableSchedule(targetDescription)
    ) {
      throw new Error(
        `Target ${migration.targetNamespace}/${source.scheduleId} does not match source`,
      );
    }
    const state = decodeMigrationState(targetDescription.state.note);
    if (state.cutoverAt === undefined) {
      throw new Error(
        `Target ${migration.targetNamespace}/${source.scheduleId} has no persisted cutover boundary`,
      );
    }
    if (state.cutoverAt !== input.cutoverAt.toISOString()) {
      throw new Error(
        `Target ${migration.targetNamespace}/${source.scheduleId} has a persisted cutover boundary that differs from the audit boundary`,
      );
    }
    if (targetDescription.state.paused !== state.sourcePaused) {
      throw new Error(
        `Target ${migration.targetNamespace}/${source.scheduleId} pause state differs from its pre-cutover source state`,
      );
    }
  }

  const queries = migrationAuditQueries(input.cutoverAt);
  for await (const execution of input.sourceClient.workflow.list({
    query: queries.open,
  })) {
    throw new Error(
      `Workflow ${execution.workflowId} remains open in default during drain audit`,
    );
  }
  for await (const execution of input.sourceClient.workflow.list({
    query: queries.startedAfterCutover,
  })) {
    if (!dependencies.isRootWorkflowExecution(execution)) continue;
    throw new Error(
      `Workflow ${execution.workflowId} started in default after cutover`,
    );
  }
}
