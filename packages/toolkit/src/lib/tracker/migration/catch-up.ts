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
      before.data.envelope.key === next.data.envelope.key &&
      before.data.envelope.kind === next.data.envelope.kind
    );
  if (before.entityType === "team" && next.entityType === "team")
    return (
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

function removalRetention(
  previous: MigrationRecord[],
  current: Set<string>,
  retainRemoved: readonly string[],
  retentionRecords: MigrationRecord[],
) {
  const retainedIssues = retentionRecords.filter(
    (record) =>
      record.entityType === "issue" &&
      !current.has(identity(record)) &&
      retainRemoved.includes(record.data.identifier) &&
      record.data.archivedAt !== null,
  );
  const retainedIds = new Set(
    retainedIssues.map((record) => record.externalId),
  );
  const retainedReferences = new Set(
    retainedIssues.flatMap((record) =>
      record.entityType === "issue" ? [record.data.identifier] : [],
    ),
  );
  if (retainRemoved.some((identifier) => !retainedReferences.has(identifier)))
    throw new Error(
      "--retain-removed must identify a removed issue already archived in the previous snapshot",
    );
  if (
    previous.some(
      (record) =>
        !current.has(identity(record)) &&
        !(
          record.entityType === "issue" && retainedIds.has(record.externalId)
        ) &&
        !(
          record.entityType === "event" &&
          record.data.action === "imported-from-linear" &&
          retainedIds.has(record.data.entityExternalId)
        ),
    )
  )
    throw new Error(
      "Linear removed a previously imported record; reconcile it before cutover",
    );
  return retainedReferences;
}

/** Refuse removals and unsupported edits before the first destination mutation. */
export function planCatchUp(
  previous: MigrationRecord[],
  next: MigrationRecord[],
  retainRemoved: readonly string[] = [],
  retentionRecords: MigrationRecord[] = previous,
) {
  const old = new Map(previous.map((record) => [identity(record), record]));
  const current = new Set(next.map((record) => identity(record)));
  const retainedReferences = removalRetention(
    previous,
    current,
    retainRemoved,
    retentionRecords,
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
  return {
    additions,
    updates,
    retained,
    retainedRemovals: [...retainedReferences],
  };
}

async function preflight(
  client: TrackerClient,
  snapshot: Awaited<ReturnType<typeof loadExport>>,
  options: {
    previous: MigrationRecord[];
    retainRemoved: readonly string[];
    retentionRecords: MigrationRecord[];
  },
) {
  const { previous, retainRemoved, retentionRecords } = options;
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
  for (const record of retentionRecords) {
    if (
      record.entityType === "issue" &&
      retainRemoved.includes(record.data.identifier)
    )
      expected.set(record.data.identifier, "linear:" + record.externalId);
  }
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
        (issue) =>
          issue.externalRef !== expected.get(issue.identifier) ||
          (retainRemoved.includes(issue.identifier) &&
            (issue.archivedAt === null || issue.revision !== 1)),
      )
    )
      throw new Error("Destination contains a native or conflicting issue");
  }
}

export async function importAdditions(
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
    try {
      const result = await options.client.import.record.mutate(record);
      if (result.status === "imported") imported++;
      else unchanged++;
    } finally {
      if (record.entityType === "attachment") record.data.contentBase64 = "";
    }
  }
  return { imported, unchanged };
}

export async function catchUpLinear(options: {
  directory: string;
  previous: string;
  actor: ActorEnvelope;
  client: TrackerClient;
  dryRun: boolean;
  retainRemoved?: readonly string[];
  retentionSource?: string | undefined;
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
  const retentionSnapshot =
    options.retentionSource === undefined
      ? before
      : await loadExport(options.retentionSource);
  if (
    retentionSnapshot.workspace.id !== before.workspace.id ||
    retentionSnapshot.sharedUserId !== before.sharedUserId
  )
    throw new Error(
      "Retention source belongs to a different Linear workspace or credential identity",
    );
  const retention = await planMigration(retentionSnapshot, options.actor);
  const plan = planCatchUp(
    previous.records,
    next.records,
    options.retainRemoved,
    retention.records,
  );
  const summary = {
    additions: plan.additions.length,
    updates: plan.updates.length,
    retained: plan.retained,
    retainedRemovals: plan.retainedRemovals,
  };
  if (options.dryRun) return { dryRun: true, ...summary };
  await preflight(options.client, after, {
    previous: previous.records,
    retainRemoved: plan.retainedRemovals,
    retentionRecords: retention.records,
  });
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
