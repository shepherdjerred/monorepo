import { ColdStartSnapshotSchema } from "#shared/model/cold-start-contract.ts";
import { stepStageKey } from "#shared/model/stage-keys.ts";
import type {
  ColdStartEnvironment,
  ColdStartSnapshot,
} from "#shared/model/cold-start-contract.ts";
import type { Database } from "#infrastructure/database.ts";
import { version, type Transaction } from "#infrastructure/delivery-data.ts";
import { fingerprint } from "#infrastructure/delivery-records.ts";

type Reader = Transaction | Database;
type Edge = { dependentId: string; prerequisiteId: string };

/**
 * Stage keys whose operation identity names the effect that converged a
 * target: the v1 reconcile stage and the model executor's sync step.
 */
const CONVERGING_STAGES = new Set(["reconcile", stepStageKey("step", "sync")]);

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

async function acceptedSelection(
  db: Reader,
  deploymentId: string,
): Promise<ColdStartEnvironment["accepted"]> {
  const row = await db.deployment.findUniqueOrThrow({
    where: { id: deploymentId },
    include: { stages: true },
  });
  const selected = await version(db, row.versionSetRevisionId);
  const converged = row.stages
    .filter(
      (stage) =>
        CONVERGING_STAGES.has(stage.key) && stage.status === "succeeded",
    )
    .toSorted(
      (left, right) => left.updatedAt.getTime() - right.updatedAt.getTime(),
    )
    .at(-1);
  return {
    deploymentId: row.id,
    versionSetRevisionId: row.versionSetRevisionId,
    recipeRevisionId: row.pipelineRevisionId,
    configurationRevisionId: row.configurationId,
    operationId: converged === undefined ? null : converged.operationId,
    artifacts: Object.fromEntries(
      Object.entries(selected.components).map(([component, artifact]) => [
        component,
        {
          uri: artifact.uri,
          digest: artifact.digest,
          version: artifact.version,
        },
      ]),
    ),
  };
}

/**
 * Every environment's accepted selection with the recipes, configurations
 * and edges the bootstrap tool needs to run the chain as operator-run
 * deployments (X7). Deterministic apart from `writtenAt`.
 */
export async function coldStartSnapshot(
  db: Reader,
  deploymentId: string,
  writtenAt: Date,
): Promise<{ snapshot: ColdStartSnapshot; fingerprint: string }> {
  const chain = await bootstrapChain(db);
  const environments = await db.environment.findMany({
    orderBy: { id: "asc" },
  });
  const rows: ColdStartEnvironment[] = [];
  const recipeIds = new Set<string>();
  const configurationIds = new Set<string>();
  for (const env of environments) {
    const accepted =
      env.acceptedDeploymentId === null
        ? null
        : await acceptedSelection(db, env.acceptedDeploymentId);
    if (accepted !== null) {
      recipeIds.add(accepted.recipeRevisionId);
      configurationIds.add(accepted.configurationRevisionId);
    }
    const order = chain.indexOf(env.id);
    rows.push({
      id: env.id,
      serviceId: env.serviceId,
      lifecycle:
        ColdStartSnapshotSchema.shape.environments.element.shape.lifecycle.parse(
          env.lifecycle,
        ),
      bootstrapOrder: order === -1 ? null : order,
      accepted,
    });
  }
  const recipes = await db.pipeline.findMany({
    where: { id: { in: [...recipeIds] } },
    orderBy: { id: "asc" },
  });
  const configurations = await db.configuration.findMany({
    where: { id: { in: [...configurationIds] } },
    orderBy: { id: "asc" },
  });
  const edges = await db.prerequisiteEdge.findMany({
    orderBy: [{ dependentId: "asc" }, { prerequisiteId: "asc" }],
  });
  const body = {
    schema: "delivery-cold-start/v1" as const,
    deploymentId,
    recipes: Object.fromEntries(recipes.map((row) => [row.id, row.definition])),
    configurations: Object.fromEntries(
      configurations.map((row) => [row.id, row.content]),
    ),
    edges: edges.map((edge) => ({
      dependentId: edge.dependentId,
      prerequisiteId: edge.prerequisiteId,
      rule: edge.rule,
    })),
    environments: rows,
  };
  const snapshot = ColdStartSnapshotSchema.parse({
    ...body,
    writtenAt: writtenAt.toISOString(),
  });
  return { snapshot, fingerprint: snapshotFingerprint(snapshot) };
}

/**
 * Covers the selections, recipes, configurations and edges, not the trigger
 * or the clock, so snapshots written by different acceptances compare.
 */
export function snapshotFingerprint(snapshot: ColdStartSnapshot) {
  return `sha256:${fingerprint({
    recipes: snapshot.recipes,
    configurations: snapshot.configurations,
    edges: snapshot.edges,
    environments: snapshot.environments,
  })}`;
}
