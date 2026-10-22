import { DeliveryError } from "#domain/error.ts";
import { reconciledCatalog } from "#infrastructure/catalog/state.ts";
import {
  ColdStartSnapshotSchema,
  SnapshotEnvironmentSchema,
  type ColdStartSnapshot,
  type SnapshotEnvironment,
} from "#shared/model/cold-start-contract.ts";
import {
  SelectionSchema,
  type Selection,
} from "#shared/model/selection-contract.ts";
import { stepStageKey } from "#shared/model/stage-keys.ts";
import type { Database } from "#infrastructure/database.ts";
import { version, type Transaction } from "#infrastructure/delivery-data.ts";
import { fingerprint } from "#infrastructure/delivery-records.ts";

type Reader = Transaction | Database;
type Edge = { dependentId: string; prerequisiteId: string };

/**
 * Stage keys whose operation identity names the effect that converged a
 * target: the v1 reconcile stage and the model executor's sync step.
 */
export const CONVERGING_STAGES = new Set([
  "reconcile",
  stepStageKey("step", "sync"),
]);

/**
 * The bootstrap chain (section 6): every environment of a self-hosted
 * service plus its transitive prerequisites, prerequisites first, ties by
 * id. The chain is derived from catalog data, never a hard-coded list.
 */
export async function bootstrapChain(db: Reader): Promise<string[]> {
  const roots = await db.environment.findMany({
    where: { service: { selfHosted: true }, lifecycle: { not: "retired" } },
    select: { id: true },
  });
  const edges: Edge[] = await db.prerequisiteEdge.findMany({
    select: { dependentId: true, prerequisiteId: true },
  });
  const prerequisites = new Map<string, string[]>();
  for (const edge of edges)
    prerequisites.set(edge.dependentId, [
      ...(prerequisites.get(edge.dependentId) ?? []),
      edge.prerequisiteId,
    ]);
  const ordered: string[] = [];
  const visiting = new Set<string>();
  function visit(id: string) {
    if (ordered.includes(id)) return;
    if (visiting.has(id))
      throw new Error(`Prerequisite edges form a cycle through ${id}`);
    visiting.add(id);
    for (const prerequisite of (prerequisites.get(id) ?? []).toSorted())
      visit(prerequisite);
    visiting.delete(id);
    ordered.push(id);
  }
  for (const root of roots.map((row) => row.id).toSorted()) visit(root);
  return ordered;
}

/** The selection a deployment froze (4.9); within an environment it names that selection (L1). */
export function frozenSelection(row: {
  versionSetRevisionId: string;
  pipelineRevisionId: string;
  configurationId: string;
}): Selection {
  return SelectionSchema.parse({
    versionSetRevisionId: row.versionSetRevisionId,
    recipeRevisionId: row.pipelineRevisionId,
    configurationRevisionId: row.configurationId,
  });
}

async function snapshotEnvironment(
  db: Reader,
  environmentId: string,
  deploymentId: string,
): Promise<SnapshotEnvironment> {
  const row = await db.deployment.findUniqueOrThrow({
    where: { id: deploymentId },
  });
  if (row.finishedAt === null)
    throw new Error(`Accepted deployment ${row.id} records no acceptance time`);
  const selected = await version(db, row.versionSetRevisionId);
  return SnapshotEnvironmentSchema.parse({
    environmentId,
    deploymentId: row.id,
    acceptedAt: row.finishedAt.toISOString(),
    selection: frozenSelection(row),
    artifacts: Object.fromEntries(
      Object.entries(selected.components).map(([component, artifact]) => [
        component,
        {
          uri: artifact.uri,
          version: artifact.version,
          digest: artifact.digest,
        },
      ]),
    ),
  });
}

/**
 * Every active environment's accepted selection with every artifact of its
 * set revision, under the catalog revision deployments freeze (X7). The
 * fingerprint excludes the clock, so snapshots of one record compare equal.
 */
export async function coldStartSnapshot(
  db: Reader,
  writtenAt: Date,
): Promise<{ snapshot: ColdStartSnapshot; fingerprint: string }> {
  const catalog = await reconciledCatalog(db);
  if (catalog === null)
    throw new DeliveryError(
      "CONFLICT",
      "No catalog was reconciled; a cold-start snapshot names the catalog revision it was written under",
    );
  const environments = await db.environment.findMany({
    where: { lifecycle: "active", acceptedDeploymentId: { not: null } },
    orderBy: { id: "asc" },
  });
  const rows: SnapshotEnvironment[] = [];
  for (const env of environments)
    if (env.acceptedDeploymentId !== null)
      rows.push(
        await snapshotEnvironment(db, env.id, env.acceptedDeploymentId),
      );
  const snapshot = ColdStartSnapshotSchema.parse({
    writtenAt: writtenAt.toISOString(),
    catalogRevision: catalog.catalogRevision,
    environments: rows,
  });
  return { snapshot, fingerprint: snapshotFingerprint(snapshot) };
}

/** Covers the catalog revision and selections, not the clock. */
export function snapshotFingerprint(snapshot: ColdStartSnapshot) {
  return `sha256:${fingerprint({
    catalogRevision: snapshot.catalogRevision,
    environments: snapshot.environments,
  })}`;
}
