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

const MIGRATION_NOTE_PREFIX = "temporal-namespace-migration:v1:";
const SOURCE_MIGRATION_NOTE =
  "Migrated to environment-scoped Temporal namespace";

export type MigrationTargetNamespace = Exclude<TemporalNamespace, "dev">;

export type MigrationSchedule = {
  source: ScheduleDescription;
  targetNamespace: MigrationTargetNamespace;
};

export type MigrationState = {
  sourcePaused: boolean;
  sourceNote: string | undefined;
};

const MigrationStateSchema = z.object({
  sourcePaused: z.boolean(),
  sourceNote: z.string().optional(),
});

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

export function encodeMigrationState(state: MigrationState): string {
  return `${MIGRATION_NOTE_PREFIX}${Buffer.from(JSON.stringify(state)).toString("base64url")}`;
}

export function decodeMigrationState(note: string | undefined): MigrationState {
  if (note?.startsWith(MIGRATION_NOTE_PREFIX) !== true) {
    throw new Error("Target schedule is missing migration state");
  }
  const encoded = note.slice(MIGRATION_NOTE_PREFIX.length);
  const state = MigrationStateSchema.parse(
    JSON.parse(Buffer.from(encoded, "base64url").toString()) as unknown,
  );
  return { sourcePaused: state.sourcePaused, sourceNote: state.sourceNote };
}

export function sourceStateAllowsCutover(
  current: { paused: boolean; note?: string },
  prepared: MigrationState,
): boolean {
  return (
    (current.note === SOURCE_MIGRATION_NOTE && current.paused) ||
    (current.note === prepared.sourceNote &&
      current.paused === prepared.sourcePaused)
  );
}

export function targetPauseAction(
  currentPaused: boolean,
  prepared: MigrationState,
): "pause" | "unpause" | undefined {
  if (!currentPaused && prepared.sourcePaused) return "pause";
  if (currentPaused && !prepared.sourcePaused) return "unpause";
  return undefined;
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
    const migrationState = decodeMigrationState(target.state.note);
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
    targets.push({ migration, target });
  }
  return targets;
}

async function pauseSourceSchedules(
  sourceClient: Client,
  targets: readonly PreparedTarget[],
): Promise<void> {
  for (const { migration } of targets) {
    const handle = sourceClient.schedule.getHandle(migration.source.scheduleId);
    const current = await handle.describe();
    if (!current.state.paused) {
      await handle.pause(SOURCE_MIGRATION_NOTE);
    }
  }
}

async function activateTargetSchedules(
  targetClients: ReadonlyMap<MigrationTargetNamespace, Client>,
  targets: readonly PreparedTarget[],
): Promise<void> {
  for (const { migration, target } of targets) {
    const state = decodeMigrationState(target.state.note);
    const handle = targetClient(
      targetClients,
      migration.targetNamespace,
    ).schedule.getHandle(migration.source.scheduleId);
    const action = targetPauseAction(target.state.paused, state);
    if (action === "pause") {
      await handle.pause(target.state.note);
    }
    if (action === "unpause") {
      await handle.unpause(target.state.note);
    }
  }
}

function scheduleIdQuery(scheduleId: string): string {
  if (!/^[\w.-]+$/.test(scheduleId)) {
    throw new Error(`Schedule id cannot be queried safely: ${scheduleId}`);
  }
  return `TemporalScheduledById = "${scheduleId}"`;
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

export async function cutoverNamespaceMigration(input: {
  sourceClient: Client;
  schedules: readonly MigrationSchedule[];
  targetClients: ReadonlyMap<MigrationTargetNamespace, Client>;
  confirm: boolean;
}): Promise<void> {
  if (!input.confirm) {
    throw new Error("cutover requires --confirm");
  }

  const targets = await validatePreparedTargets(input);
  await pauseSourceSchedules(input.sourceClient, targets);
  await activateTargetSchedules(input.targetClients, targets);
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
      decodeMigrationState(target.state.note);
      prepared.push({ migration, target });
    }
  }

  for (const { migration, target } of prepared) {
    if (!target.state.paused) {
      await targetClient(input.targetClients, migration.targetNamespace)
        .schedule.getHandle(migration.source.scheduleId)
        .pause(target.state.note);
    }
  }
  await assertNoTargetWorkflowStarts(input.targetClients, input.schedules);

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

export async function auditNamespaceMigration(input: {
  sourceClient: Client;
  schedules: readonly MigrationSchedule[];
  targetClients: ReadonlyMap<MigrationTargetNamespace, Client>;
  cutoverAt: Date;
}): Promise<void> {
  for (const migration of input.schedules) {
    const source = await input.sourceClient.schedule
      .getHandle(migration.source.scheduleId)
      .describe();
    if (!source.state.paused) {
      throw new Error(`Source default/${source.scheduleId} is active`);
    }
    const target = await targetClient(
      input.targetClients,
      migration.targetNamespace,
    )
      .schedule.getHandle(source.scheduleId)
      .describe();
    if (comparableSchedule(source) !== comparableSchedule(target)) {
      throw new Error(
        `Target ${migration.targetNamespace}/${source.scheduleId} does not match source`,
      );
    }
    const state = decodeMigrationState(target.state.note);
    if (target.state.paused !== state.sourcePaused) {
      throw new Error(
        `Target ${migration.targetNamespace}/${source.scheduleId} pause state differs from its pre-cutover source state`,
      );
    }
  }

  const query = `StartTime >= "${input.cutoverAt.toISOString()}"`;
  for await (const execution of input.sourceClient.workflow.list({ query })) {
    throw new Error(
      `Workflow ${execution.workflowId} started in default after cutover`,
    );
  }
}
