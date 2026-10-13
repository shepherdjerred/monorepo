import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ActorEnvelope } from "@shepherdjerred/tracker/contract";
import type { TrackerClient } from "#lib/tracker/client.ts";
import { exportFiles, hash, readExportFile } from "./files.ts";
import { LinearExportSchema, type LinearExport } from "./schema.ts";
import { exportLinear } from "./source.ts";
import { planMigration, type MigrationRecord } from "./normalize.ts";

function migrationSummary(snapshot: LinearExport, records: MigrationRecord[]) {
  const counts: Record<string, number> = {};
  for (const record of records)
    counts[record.entityType] = (counts[record.entityType] ?? 0) + 1;
  return {
    workspace: snapshot.workspace.urlKey,
    exportedAt: snapshot.exportedAt,
    counts,
    files: snapshot.files.length,
    fileBytes: snapshot.files.reduce((sum, file) => sum + file.sizeBytes, 0),
    teams: snapshot.teams.map((team) => {
      const issues = snapshot.issues.filter(
        (issue) => issue.team.id === team.id,
      );
      const states: Record<string, number> = {};
      for (const issue of issues) {
        const state = snapshot.states.find(
          (item) => item.id === issue.state.id,
        );
        if (state === undefined) throw new Error("Exported issue has no state");
        states[state.name] = (states[state.name] ?? 0) + 1;
      }
      return {
        key: team.key,
        issues: issues.length,
        archived: issues.filter((issue) => issue.archivedAt !== null).length,
        highestNumber: Math.max(0, ...issues.map((issue) => issue.number)),
        states,
      };
    }),
    retainedSourceOnly: {
      projectComments: snapshot.comments.filter(
        (comment) => comment.issue === null,
      ).length,
    },
  };
}

export async function createExport(directory: string, resume = false) {
  if (!resume) await mkdir(directory, { mode: 0o700 });
  if (
    resume &&
    (await Bun.file(path.join(directory, "export.json")).exists())
  ) {
    const snapshot = await loadExport(directory);
    return {
      directory,
      issues: snapshot.issues.length,
      files: snapshot.files.length,
      unchanged: true,
    };
  }
  const snapshot = resume
    ? await loadSnapshot(directory, "source")
    : await exportLinear();
  if (!resume) {
    const source = JSON.stringify(snapshot, null, 2) + "\n";
    await writeFile(path.join(directory, "source.json"), source, {
      mode: 0o600,
      flag: "wx",
    });
    await writeFile(
      path.join(directory, "source.sha256"),
      hash(source) + "\n",
      { mode: 0o600, flag: "wx" },
    );
  }
  snapshot.files = await exportFiles(snapshot, directory, resume);
  const body = JSON.stringify(snapshot, null, 2) + "\n";
  await writeFile(path.join(directory, "export.json"), body, {
    mode: 0o600,
    flag: "wx",
  });
  await writeFile(path.join(directory, "export.sha256"), hash(body) + "\n", {
    mode: 0o600,
    flag: "wx",
  });
  return {
    directory,
    sha256: hash(body),
    issues: snapshot.issues.length,
    files: snapshot.files.length,
  };
}

async function loadSnapshot(directory: string, stem: string) {
  const body = await Bun.file(path.join(directory, stem + ".json")).text();
  const digestBody = await Bun.file(
    path.join(directory, stem + ".sha256"),
  ).text();
  const expected = digestBody.trim();
  if (!/^[a-f0-9]{64}$/u.test(expected) || hash(body) !== expected)
    throw new Error("Linear export manifest checksum mismatch");
  const snapshot = LinearExportSchema.parse(JSON.parse(body));
  for (const file of snapshot.files) await readExportFile(directory, file);
  return snapshot;
}

export const loadExport = (directory: string) =>
  loadSnapshot(directory, "export");

type ImportOptions = {
  directory: string;
  actor: ActorEnvelope;
  client: TrackerClient;
  dryRun: boolean;
  only?: string | undefined;
};

async function preflightDestination(
  snapshot: LinearExport,
  client: TrackerClient,
) {
  const bootstrap = await client.meta.bootstrap.query();
  if (bootstrap.writesEnabled)
    throw new Error("Pause native Tracker writes before importing");
  // Preflight every existing issue collision before the first catalog mutation.
  for (const team of snapshot.teams) {
    const existing = await client.issues.list.query({
      teamKey: team.key,
      includeArchived: true,
      limit: "all",
      states: [],
      labels: [],
      sort: "updated",
    });
    const incoming = new Map(
      snapshot.issues.map((issue) => [issue.identifier, "linear:" + issue.id]),
    );
    for (const issue of existing.items)
      if (issue.externalRef !== incoming.get(issue.identifier))
        throw new Error(
          "Destination contains a native or conflicting issue: " +
            issue.identifier,
        );
  }
}

async function applyRecords(
  options: ImportOptions,
  plan: Awaited<ReturnType<typeof planMigration>>,
) {
  let imported = 0;
  let unchanged = 0;
  for (const record of plan.records) {
    if (options.only !== undefined && record.entityType !== options.only)
      continue;
    if (record.entityType === "attachment") {
      const file = plan.attachments.get(record.externalId);
      if (file === undefined)
        throw new Error("Missing planned attachment bytes");
      record.data.contentBase64 = Buffer.from(
        await readExportFile(options.directory, file),
      ).toString("base64");
    }
    const result = await options.client.import.record.mutate(record);
    if (result.status === "imported") imported++;
    else unchanged++;
    console.error(
      "Import " +
        record.entityType +
        ": " +
        (imported + unchanged).toString() +
        "/" +
        plan.records.length.toString(),
    );
    if (record.entityType === "attachment") record.data.contentBase64 = "";
  }
  return { imported, unchanged };
}

export async function runImport(options: ImportOptions) {
  const snapshot = await loadExport(options.directory);
  const plan = await planMigration(snapshot, options.actor);
  if (
    options.only !== undefined &&
    !plan.records.some((record) => record.entityType === options.only)
  )
    throw new Error("--only must name an exported entity type");
  const summary = migrationSummary(snapshot, plan.records);
  if (options.dryRun) return { dryRun: true, ...summary };
  await preflightDestination(snapshot, options.client);
  return { dryRun: false, ...(await applyRecords(options, plan)), ...summary };
}
