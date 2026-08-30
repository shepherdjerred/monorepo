import type { Client, ScheduleDescription } from "@temporalio/client";
import { ScheduleNotFoundError } from "@temporalio/client";
import {
  ScoutScheduleOwnershipMemoSchema,
  scoutReportScheduleId,
} from "@scout-for-lol/temporal";
import { z } from "zod";
import { DYNAMIC_AGENT_TASK_MEMO_KEY } from "#shared/agent-task-identifiers.ts";
import type { TemporalNamespace } from "#shared/temporal-namespace.ts";
import { SCHEDULES } from "./schedule-definitions.ts";
import {
  cutoverTimestampForRetry,
  decodeMigrationState,
  encodeMigrationState,
  SOURCE_MIGRATION_NOTE,
  sourceStateAllowsCutover,
  targetPauseAction,
  type MigrationState,
} from "./namespace-migration-state.ts";
import {
  auditNamespaceMigration as auditNamespaceMigrationImpl,
  type NamespaceMigrationAuditInput,
} from "./namespace-migration-audit.ts";
export type MigrationTargetNamespace = Exclude<TemporalNamespace, "dev">;

export type MigrationSchedule = {
  source: ScheduleDescription;
  targetNamespace: MigrationTargetNamespace;
};
const SearchAttributesSchema = z
  .record(
    z.string(),
    z.union([
      z.array(z.string()),
      z.array(z.number()),
      z.array(z.boolean()),
      z.array(z.date()),
    ]),
  )
  .optional();
export function isRootWorkflowExecution(execution: {
  runId: string;
  rootExecution?: { runId: string | null } | null;
}): boolean {
  return (
    execution.rootExecution === undefined ||
    execution.rootExecution === null ||
    execution.rootExecution.runId === execution.runId
  );
}
export function classifyScheduleNamespace(
  scheduleId: string,
  memo: Record<string, unknown> | undefined,
): MigrationTargetNamespace {
  const declared = SCHEDULES.find((schedule) => schedule.id === scheduleId);
  if (declared !== undefined) {
    if (declared.namespace === "dev") {
      throw new Error(`Production schedule ${scheduleId} targets dev`);
    }
    return declared.namespace;
  }

  const scoutMemo = ScoutScheduleOwnershipMemoSchema.safeParse(memo);
  if (scoutMemo.success) {
    const expectedId = scoutReportScheduleId(
      scoutMemo.data.stage,
      scoutMemo.data.reportId,
    );
    if (scheduleId !== expectedId || scoutMemo.data.stage === "dev") {
      throw new Error(`Unknown Scout schedule ownership for ${scheduleId}`);
    }
    return scoutMemo.data.stage;
  }

  if (
    scheduleId.startsWith("agent-task-") ||
    memo?.[DYNAMIC_AGENT_TASK_MEMO_KEY] === true
  ) {
    return "prod";
  }

  throw new Error(`Unknown schedule ownership for ${scheduleId}`);
}
function comparableSchedule(description: ScheduleDescription): string {
  return JSON.stringify({
    spec: description.spec,
    action: description.action,
    policies: description.policies,
    memo: description.memo,
    searchAttributes: readSearchAttributes(description),
    typedSearchAttributes: description.typedSearchAttributes,
  });
}
function readSearchAttributes(description: ScheduleDescription) {
  return SearchAttributesSchema.parse(
    Reflect.get(description, "searchAttributes"),
  );
}
export async function inventoryMigrationSchedules(
  sourceClient: Client,
): Promise<MigrationSchedule[]> {
  const schedules: MigrationSchedule[] = [];
  for await (const summary of sourceClient.schedule.list()) {
    const source = await sourceClient.schedule
      .getHandle(summary.scheduleId)
      .describe();
    schedules.push({
      source,
      targetNamespace: classifyScheduleNamespace(
        source.scheduleId,
        source.memo,
      ),
    });
  }
  return schedules.sort((left, right) =>
    left.source.scheduleId.localeCompare(right.source.scheduleId),
  );
}
async function describeIfPresent(
  client: Client,
  scheduleId: string,
): Promise<ScheduleDescription | undefined> {
  try {
    return await client.schedule.getHandle(scheduleId).describe();
  } catch (error: unknown) {
    if (error instanceof ScheduleNotFoundError) return undefined;
    throw error;
  }
}
function targetClient(
  clients: ReadonlyMap<MigrationTargetNamespace, Client>,
  namespace: MigrationTargetNamespace,
): Client {
  const client = clients.get(namespace);
  if (client === undefined) {
    throw new Error(`Missing Temporal client for namespace ${namespace}`);
  }
  return client;
}
function validateExistingPreparedTarget(
  existing: ScheduleDescription,
  schedule: MigrationSchedule,
): void {
  if (comparableSchedule(existing) !== comparableSchedule(schedule.source)) {
    throw new Error(
      `Prepared target ${schedule.targetNamespace}/${schedule.source.scheduleId} differs from default`,
    );
  }
  decodeMigrationState(existing.state.note);
  if (!existing.state.paused) {
    throw new Error(
      `Prepared target ${schedule.targetNamespace}/${schedule.source.scheduleId} is active`,
    );
  }
}
function assertTargetHasNotFired(
  target: ScheduleDescription,
  migration: MigrationSchedule,
): void {
  if (
    target.info.numActionsTaken !== 0 ||
    target.info.recentActions.length > 0
  ) {
    throw new Error(
      `Prepared target ${migration.targetNamespace}/${migration.source.scheduleId} has already started an action`,
    );
  }
}
export async function prepareNamespaceMigration(input: {
  schedules: readonly MigrationSchedule[];
  targetClients: ReadonlyMap<MigrationTargetNamespace, Client>;
  confirm: boolean;
}): Promise<void> {
  for (const schedule of input.schedules) {
    const target = targetClient(input.targetClients, schedule.targetNamespace);
    const existing = await describeIfPresent(
      target,
      schedule.source.scheduleId,
    );
    if (existing !== undefined) {
      validateExistingPreparedTarget(existing, schedule);
      continue;
    }
    if (!input.confirm) continue;
    const searchAttributes = readSearchAttributes(schedule.source);
    await target.schedule.create({
      scheduleId: schedule.source.scheduleId,
      spec: schedule.source.spec,
      action: schedule.source.action,
      policies: schedule.source.policies,
      ...(schedule.source.memo === undefined
        ? {}
        : { memo: schedule.source.memo }),
      ...(searchAttributes === undefined ? {} : { searchAttributes }),
      typedSearchAttributes: schedule.source.typedSearchAttributes,
      state: {
        paused: true,
        note: encodeMigrationState({
          sourcePaused: schedule.source.state.paused,
          sourceNote: schedule.source.state.note,
        }),
        ...(schedule.source.state.remainingActions === undefined
          ? {}
          : { remainingActions: schedule.source.state.remainingActions }),
      },
    });
  }
}
type PreparedTarget = {
  migration: MigrationSchedule;
  target: ScheduleDescription;
  migrationState: MigrationState;
};
async function validatePreparedTargets(input: {
  sourceClient: Client;
  schedules: readonly MigrationSchedule[];
  targetClients: ReadonlyMap<MigrationTargetNamespace, Client>;
}): Promise<PreparedTarget[]> {
  const targets: PreparedTarget[] = [];
  for (const migration of input.schedules) {
    const target = await describeIfPresent(
      targetClient(input.targetClients, migration.targetNamespace),
      migration.source.scheduleId,
    );
    if (target === undefined) {
      throw new Error(
        `Target ${migration.targetNamespace}/${migration.source.scheduleId} is not prepared`,
      );
    }
    if (comparableSchedule(target) !== comparableSchedule(migration.source)) {
      throw new Error(
        `Target ${migration.targetNamespace}/${migration.source.scheduleId} drifted after prepare`,
      );
    }
    assertTargetHasNotFired(target, migration);
    const migrationState = decodeMigrationState(target.state.note);
    if (migrationState.cutoverAt === undefined && !target.state.paused) {
      throw new Error(
        `Prepared target ${migration.targetNamespace}/${migration.source.scheduleId} must remain paused until cutover`,
      );
    }
    const currentSource = await input.sourceClient.schedule
      .getHandle(migration.source.scheduleId)
      .describe();
    if (
      comparableSchedule(currentSource) !== comparableSchedule(migration.source)
    ) {
      throw new Error(
        `Source default/${migration.source.scheduleId} drifted after inventory`,
      );
    }
    if (!sourceStateAllowsCutover(currentSource.state, migrationState)) {
      throw new Error(
        `Source default/${migration.source.scheduleId} pause state drifted after prepare`,
      );
    }
    targets.push({ migration, target, migrationState });
  }
  return targets;
}
async function persistCutoverBoundary(
  targetClients: ReadonlyMap<MigrationTargetNamespace, Client>,
  targets: readonly PreparedTarget[],
  cutoverAt: Date,
): Promise<void> {
  const cutoverAtIso = cutoverAt.toISOString();
  for (const { migration, migrationState } of targets) {
    if (migrationState.cutoverAt === cutoverAtIso) continue;
    await targetClient(targetClients, migration.targetNamespace)
      .schedule.getHandle(migration.source.scheduleId)
      .update((previous) => ({
        ...previous,
        state: {
          ...previous.state,
          note: encodeMigrationState({
            ...migrationState,
            cutoverAt: cutoverAtIso,
          }),
        },
      }));
  }
}
async function persistMigrationAttempt(
  targetClients: ReadonlyMap<MigrationTargetNamespace, Client>,
  targets: readonly PreparedTarget[],
  attemptedAt: Date,
): Promise<void> {
  const attemptedAtIso = attemptedAt.toISOString();
  for (const { migration, migrationState } of targets) {
    if (migrationState.attemptedAt !== undefined) continue;
    const handle = targetClient(
      targetClients,
      migration.targetNamespace,
    ).schedule.getHandle(migration.source.scheduleId);
    await handle.update((previous) => ({
      ...previous,
      state: {
        ...previous.state,
        note: encodeMigrationState({
          ...migrationState,
          attemptedAt: attemptedAtIso,
        }),
      },
    }));
  }
}
async function pauseSourceSchedules(
  sourceClient: Client,
  targetClients: ReadonlyMap<MigrationTargetNamespace, Client>,
  targets: readonly PreparedTarget[],
  cutoverAt: Date,
): Promise<Date> {
  let persistedBoundary = targets.some(
    ({ migrationState }) => migrationState.cutoverAt !== undefined,
  );
  for (const { migration } of targets) {
    const handle = sourceClient.schedule.getHandle(migration.source.scheduleId);
    const current = await handle.describe();
    if (!current.state.paused) {
      await handle.pause(SOURCE_MIGRATION_NOTE);
      if (!persistedBoundary) {
        await persistCutoverBoundary(targetClients, targets, cutoverAt);
        persistedBoundary = true;
      }
    }
  }
  if (!persistedBoundary) {
    await persistCutoverBoundary(targetClients, targets, cutoverAt);
  }
  return cutoverAt;
}
async function activateTargetSchedules(
  targetClients: ReadonlyMap<MigrationTargetNamespace, Client>,
  targets: readonly PreparedTarget[],
): Promise<void> {
  for (const { migration, target, migrationState } of targets) {
    const handle = targetClient(
      targetClients,
      migration.targetNamespace,
    ).schedule.getHandle(migration.source.scheduleId);
    const action = targetPauseAction(target.state.paused, migrationState);
    const note = encodeMigrationState(migrationState);
    if (action === "pause") {
      await handle.pause(note);
    }
    if (action === "unpause") {
      await handle.unpause(note);
    }
  }
}
function scheduleIdQuery(scheduleId: string): string {
  return `TemporalScheduledById = ${JSON.stringify(scheduleId)}`;
}
async function assertNoTargetWorkflowStarts(
  targetClients: ReadonlyMap<MigrationTargetNamespace, Client>,
  schedules: readonly MigrationSchedule[],
): Promise<void> {
  for (const migration of schedules) {
    const client = targetClient(targetClients, migration.targetNamespace);
    const query = scheduleIdQuery(migration.source.scheduleId);
    for await (const execution of client.workflow.list({ query })) {
      throw new Error(
        `Rollback forbidden: ${migration.targetNamespace}/${execution.workflowId} has already started`,
      );
    }
  }
}
async function waitForNoTargetWorkflowStarts(
  targetClients: ReadonlyMap<MigrationTargetNamespace, Client>,
  schedules: readonly MigrationSchedule[],
): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await assertNoTargetWorkflowStarts(targetClients, schedules);
    if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}
export async function cutoverNamespaceMigration(input: {
  sourceClient: Client;
  schedules: readonly MigrationSchedule[];
  targetClients: ReadonlyMap<MigrationTargetNamespace, Client>;
  confirm: boolean;
}): Promise<Date> {
  if (!input.confirm) {
    throw new Error("cutover requires --confirm");
  }

  const targets = await validatePreparedTargets(input);
  const pauseStartedAt = cutoverTimestampForRetry(targets, new Date());
  await persistMigrationAttempt(input.targetClients, targets, pauseStartedAt);
  await assertNoTargetWorkflowStarts(input.targetClients, input.schedules);
  const cutoverAt = await pauseSourceSchedules(
    input.sourceClient,
    input.targetClients,
    targets,
    pauseStartedAt,
  );
  // The first successful source pause persists the boundary immediately. If a
  // retry follows a partial pause, the durable boundary is reused.
  await persistCutoverBoundary(input.targetClients, targets, cutoverAt);
  const targetsWithBoundary = targets.map((target) => ({
    ...target,
    migrationState: {
      ...target.migrationState,
      cutoverAt: cutoverAt.toISOString(),
    },
  }));
  await activateTargetSchedules(input.targetClients, targetsWithBoundary);
  return cutoverAt;
}
export async function rollbackNamespaceMigration(input: {
  sourceClient: Client;
  schedules: readonly MigrationSchedule[];
  targetClients: ReadonlyMap<MigrationTargetNamespace, Client>;
  confirm: boolean;
}): Promise<void> {
  if (!input.confirm) {
    throw new Error("rollback requires --confirm");
  }

  const prepared: PreparedTarget[] = [];
  for (const migration of input.schedules) {
    const target = await describeIfPresent(
      targetClient(input.targetClients, migration.targetNamespace),
      migration.source.scheduleId,
    );
    if (target !== undefined) {
      prepared.push({
        migration,
        target,
        migrationState: decodeMigrationState(target.state.note),
      });
    }
  }

  const pausedTargets: PreparedTarget[] = [];
  try {
    for (const preparedTarget of prepared) {
      if (!preparedTarget.target.state.paused) {
        await targetClient(
          input.targetClients,
          preparedTarget.migration.targetNamespace,
        )
          .schedule.getHandle(preparedTarget.migration.source.scheduleId)
          .pause(preparedTarget.target.state.note);
        pausedTargets.push(preparedTarget);
      }
    }
    await waitForNoTargetWorkflowStarts(input.targetClients, input.schedules);
  } catch (error: unknown) {
    for (const { migration, target } of pausedTargets) {
      await targetClient(input.targetClients, migration.targetNamespace)
        .schedule.getHandle(migration.source.scheduleId)
        .unpause(target.state.note);
    }
    throw error;
  }
  for (const { migration, target } of prepared) {
    const state = decodeMigrationState(target.state.note);
    const source = input.sourceClient.schedule.getHandle(
      migration.source.scheduleId,
    );
    if (state.sourcePaused) {
      await source.pause(state.sourceNote);
    } else {
      await source.unpause(state.sourceNote);
    }
  }
  for (const { migration } of prepared) {
    await targetClient(input.targetClients, migration.targetNamespace)
      .schedule.getHandle(migration.source.scheduleId)
      .delete();
  }
}

export async function auditNamespaceMigration(
  input: NamespaceMigrationAuditInput,
): Promise<void> {
  return auditNamespaceMigrationImpl(input, {
    targetClient,
    comparableSchedule,
    isRootWorkflowExecution,
  });
}
