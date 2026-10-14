import type { ActorEnvelope } from "@shepherdjerred/tracker/contract";
import { z } from "zod";
import type { TrackerClient } from "#lib/tracker/client.ts";
import { loadExport } from "./runner.ts";
import { planMigration, type MigrationRecord } from "./normalize.ts";
import { readExportFile } from "./files.ts";

type IssueRecord = Extract<MigrationRecord, { entityType: "issue" }>;
type CommentRecord = Extract<MigrationRecord, { entityType: "comment" }>;
type Update =
  | { previous: IssueRecord; next: IssueRecord }
  | { previous: CommentRecord; next: CommentRecord };
const identity = (record: MigrationRecord) =>
  record.entityType + ":" + record.externalId;
function value(record: MigrationRecord) {
  const { actor: _actor, ...payload } = record;
  return JSON.stringify(payload);
}

function retainedCatalog(before: MigrationRecord, next: MigrationRecord) {
  if (before.entityType === "actor" && next.entityType === "actor")
    return (
      JSON.stringify(before.data.envelope) ===
      JSON.stringify(next.data.envelope)
    );
  if (before.entityType === "team" && next.entityType === "team")
    return (
      next.data.issueCounter >= before.data.issueCounter &&
      value({
        ...next,
        data: { ...next.data, issueCounter: before.data.issueCounter },
      }) === value(before)
    );
  return false;
}

function originalHistory(
  before: MigrationRecord,
  next: MigrationRecord,
  changedIssues: Set<string>,
) {
  return (
    before.entityType === "event" &&
    next.entityType === "event" &&
    before.data.action === "imported-from-linear" &&
    next.data.action === before.data.action &&
    next.data.entityExternalId === before.data.entityExternalId &&
    changedIssues.has(next.data.entityExternalId)
  );
}

function issueUpdate(previous: IssueRecord, next: IssueRecord) {
  if (
    previous.data.identifier !== next.data.identifier ||
    previous.data.createdAt !== next.data.createdAt ||
    next.rawSourcePayload["updatedAt"] !== next.data.updatedAt ||
    Date.parse(next.data.updatedAt) < Date.parse(previous.data.updatedAt)
  )
    throw new Error(
      "Linear changed issue identity or creation time: " + next.data.identifier,
    );
  return { previous, next };
}

/** Refuse removals and unsupported edits before the first destination mutation. */
export function planCatchUp(
  previous: MigrationRecord[],
  next: MigrationRecord[],
) {
  const old = new Map(previous.map((record) => [identity(record), record]));
  const current = new Set(next.map((record) => identity(record)));
  if (previous.some((record) => !current.has(identity(record))))
    throw new Error(
      "Linear removed a previously imported record; reconcile it before cutover",
    );
  const additions: MigrationRecord[] = [];
  const updates: Update[] = [];
  const changedIssues = new Set(
    next
      .filter((record) => {
        const before = old.get(identity(record));
        return (
          record.entityType === "issue" &&
          before !== undefined &&
          value(before) !== value(record)
        );
      })
      .map((record) => record.externalId),
  );
  let retained = 0;
  for (const record of next) {
    const before = old.get(identity(record));
    if (before === undefined) {
      additions.push(record);
      continue;
    }
    if (
      value(before) === value(record) ||
      retainedCatalog(before, record) ||
      originalHistory(before, record, changedIssues)
    ) {
      retained++;
      continue;
    }
    if (before.entityType === "issue" && record.entityType === "issue") {
      updates.push(issueUpdate(before, record));
      continue;
    }
    if (before.entityType === "comment" && record.entityType === "comment") {
      if (
        before.data.identifier !== record.data.identifier ||
        before.data.createdAt !== record.data.createdAt ||
        before.data.authorKey !== record.data.authorKey
      )
        throw new Error(
          "Linear changed comment identity, author, or creation time",
        );
      updates.push({ previous: before, next: record });
      continue;
    }
    throw new Error(
      "Linear changed imported content: " +
        identity(record) +
        "; reconcile it explicitly before cutover",
    );
  }
  return { additions, updates, retained };
}

async function preflight(
  client: TrackerClient,
  snapshot: Awaited<ReturnType<typeof loadExport>>,
  previous: MigrationRecord[],
) {
  const bootstrap = await client.meta.bootstrap.query();
  const capabilities = z
    .object({ importCapabilities: z.array(z.string()) })
    .safeParse(bootstrap);
  if (
    !capabilities.success ||
    !capabilities.data.importCapabilities.includes("reconcile-record-v1")
  )
    throw new Error(
      "Deploy Tracker's reconcile-record-v1 importer before catch-up",
    );
  if (bootstrap.writesEnabled)
    throw new Error("Pause native Tracker writes before importing");
  const manifest = await client.import.manifest.query();
  const imported = new Set(
    manifest.map((record) => record.entityType + ":" + record.externalId),
  );
  if (previous.some((record) => !imported.has(identity(record))))
    throw new Error("Complete the previous frozen import before catch-up");
  const expected = new Map(
    snapshot.issues.map((issue) => [issue.identifier, "linear:" + issue.id]),
  );
  for (const team of snapshot.teams) {
    const saved = await client.issues.list.query({
      teamKey: team.key,
      includeArchived: true,
      limit: "all",
      states: [],
      labels: [],
      sort: "updated",
    });
    if (
      saved.items.some(
        (issue) => issue.externalRef !== expected.get(issue.identifier),
      )
    )
      throw new Error("Destination contains a native or conflicting issue");
  }
}

async function importAdditions(
  options: { client: TrackerClient; directory: string },
  plan: ReturnType<typeof planCatchUp>,
  next: Awaited<ReturnType<typeof planMigration>>,
) {
  let imported = 0;
  let unchanged = 0;
  for (const record of plan.additions) {
    if (record.entityType === "attachment") {
      const file = next.attachments.get(record.externalId);
      if (file === undefined) throw new Error("Missing catch-up attachment");
      record.data.contentBase64 = Buffer.from(
        await readExportFile(options.directory, file),
      ).toString("base64");
    }
    const result = await options.client.import.record.mutate(record);
    if (result.status === "imported") imported++;
    else unchanged++;
  }
  return { imported, unchanged };
}

export async function catchUpLinear(options: {
  directory: string;
  previous: string;
  actor: ActorEnvelope;
  client: TrackerClient;
  dryRun: boolean;
}) {
  const before = await loadExport(options.previous);
  const after = await loadExport(options.directory);
  if (
    before.workspace.id !== after.workspace.id ||
    before.sharedUserId !== after.sharedUserId
  )
    throw new Error("Linear workspace or credential identity changed");
  const previous = await planMigration(before, options.actor);
  const next = await planMigration(after, options.actor);
  const plan = planCatchUp(previous.records, next.records);
  const summary = {
    additions: plan.additions.length,
    updates: plan.updates.length,
    retained: plan.retained,
  };
  if (options.dryRun) return { dryRun: true, ...summary };
  await preflight(options.client, after, previous.records);
  const added = await importAdditions(options, plan, next);
  let reconciled = 0;
  let unchanged = added.unchanged;
  for (const input of plan.updates) {
    const result = await options.client.import.reconcileRecord.mutate(input);
    if (result.status === "reconciled") reconciled++;
    else unchanged++;
  }
  return {
    dryRun: false,
    ...summary,
    imported: added.imported,
    reconciled,
    unchanged,
  };
}
