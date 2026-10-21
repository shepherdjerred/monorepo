import { forwardOnlyValue } from "@shepherdjerred/ops-model/catalog-document-shape.ts";
import { DeliveryError } from "#domain/error.ts";
import {
  PipelineRevisionSchema,
  type StoredRecipeDefinition,
} from "#shared/contract.ts";
import type { RollbackCandidate } from "#shared/model/selection-contract.ts";
import { pointsOfNoReturn } from "#shared/model/recipe-view.ts";
import type { Database } from "#infrastructure/database.ts";
import {
  configurationRevision,
  type Transaction,
} from "#infrastructure/delivery-data.ts";
import { required, wire } from "#infrastructure/delivery-records.ts";

/** Kinds whose success moved the accepted selection (V1). */
export const ACCEPTING_KINDS = [
  "deploy",
  "promote",
  "rollback",
  "rebind",
  "retire-host",
  "channel-publish",
  "operator-run",
  "upgrade-control-plane",
  "root-release",
  "tofu-apply",
];

function compareVersions(left: string, right: string): number {
  const a = left.split(".").map(Number);
  const b = right.split(".").map(Number);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

async function recipe(
  tx: Transaction | Database,
  recipeId: string,
): Promise<StoredRecipeDefinition> {
  return PipelineRevisionSchema.parse(
    wire(
      required(
        await tx.pipeline.findUnique({ where: { id: recipeId } }),
        "Recipe revision",
      ),
    ),
  ).definition;
}

/** A forwardOnly key the candidate would lower relative to the accepted selection (F3). */
async function loweredForwardOnly(
  tx: Transaction | Database,
  candidateConfigurationId: string,
  acceptedConfigurationId: string,
): Promise<string | null> {
  const [candidate, accepted] = await Promise.all([
    configurationRevision(tx, candidateConfigurationId),
    configurationRevision(tx, acceptedConfigurationId),
  ]);
  for (const key of accepted.forwardOnly) {
    const current = forwardOnlyValue(accepted.content, key);
    const restored = forwardOnlyValue(candidate.content, key);
    if (
      current !== undefined &&
      (restored === undefined || compareVersions(restored, current) < 0)
    )
      return `would lower forwardOnly ${key} from ${current} to ${restored ?? "nothing"}`;
  }
  return null;
}

type AcceptedRow = {
  id: string;
  versionSetRevisionId: string;
  pipelineRevisionId: string;
  configurationId: string;
  finishedAt: Date | null;
};

/** A pointOfNoReturn step any acceptance after the candidate executed (D9). */
async function crossedPointOfNoReturn(
  tx: Transaction | Database,
  later: AcceptedRow[],
): Promise<string | null> {
  for (const row of later) {
    const crossed = pointsOfNoReturn(await recipe(tx, row.pipelineRevisionId));
    if (crossed.length > 0)
      return `deployment ${row.id} crossed point of no return ${crossed.join(", ")}`;
  }
  return null;
}

async function forwardOnlyChannel(
  tx: Transaction | Database,
  row: AcceptedRow,
): Promise<boolean> {
  const definition = await recipe(tx, row.pipelineRevisionId);
  return definition.kind === "channel" && definition.forwardOnly;
}

/** Why one previously accepted selection is not a rollback source, or null. */
async function exclusion(
  tx: Transaction | Database,
  input: {
    row: AcceptedRow;
    current: AcceptedRow | undefined;
    later: AcceptedRow[];
  },
): Promise<string | null> {
  const { row, current, later } = input;
  if (current !== undefined && (await forwardOnlyChannel(tx, current)))
    return "the channel is forwardOnly and offers no rollback";
  const lowered =
    current === undefined
      ? null
      : await loweredForwardOnly(
          tx,
          row.configurationId,
          current.configurationId,
        );
  return lowered ?? crossedPointOfNoReturn(tx, later);
}

/**
 * The environment's previously accepted selections, newest first, each
 * marked eligible or excluded with its reason (D9): a forwardOnly
 * configuration key it would lower, a pointOfNoReturn step crossed since,
 * or a forwardOnly channel.
 */
export async function rollbackCandidates(
  tx: Transaction | Database,
  environmentId: string,
): Promise<RollbackCandidate[]> {
  const environment = required(
    await tx.environment.findUnique({ where: { id: environmentId } }),
    "Environment",
  );
  const accepted: AcceptedRow[] = await tx.deployment.findMany({
    where: {
      environmentId,
      status: "succeeded",
      kind: { in: ACCEPTING_KINDS },
    },
    select: {
      id: true,
      versionSetRevisionId: true,
      pipelineRevisionId: true,
      configurationId: true,
      finishedAt: true,
    },
    orderBy: [{ finishedAt: "desc" }, { createdAt: "desc" }],
  });
  const current = accepted.find(
    (row) => row.id === environment.acceptedDeploymentId,
  );
  const candidates: RollbackCandidate[] = [];
  for (const [index, row] of accepted.entries()) {
    // The accepted selection is itself a rollback source: restoring it
    // re-asserts the frozen inputs after a failed or drifted target.
    const reason = await exclusion(tx, {
      row,
      current,
      later: accepted.slice(0, index),
    });
    candidates.push({
      deploymentId: row.id,
      selection: {
        versionSetRevisionId: row.versionSetRevisionId,
        recipeRevisionId: row.pipelineRevisionId,
        configurationRevisionId: row.configurationId,
      },
      acceptedAt: (row.finishedAt ?? new Date(0)).toISOString(),
      eligible: reason === null,
      reason,
    });
  }
  return candidates;
}

/** Refuses a rollback the candidates exclude, stating why (D9). */
export async function requireRollbackCandidate(
  tx: Transaction,
  environmentId: string,
  deploymentId: string,
) {
  const candidates = await rollbackCandidates(tx, environmentId);
  const candidate = candidates.find(
    (entry) => entry.deploymentId === deploymentId,
  );
  if (candidate === undefined)
    throw new DeliveryError(
      "INVALID",
      `Deployment ${deploymentId} was never accepted in ${environmentId}; only previously accepted selections are rollback sources (V2)`,
    );
  if (!candidate.eligible)
    throw new DeliveryError(
      "INVALID",
      `Rollback to ${deploymentId} is excluded: ${candidate.reason ?? "no reason"}`,
    );
}
