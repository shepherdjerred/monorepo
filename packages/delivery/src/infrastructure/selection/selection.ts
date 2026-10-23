import { DeliveryError } from "#domain/error.ts";
import {
  PipelineRevisionSchema,
  type Environment,
  type PipelineRevision,
  type VersionSetRevision,
} from "#shared/contract.ts";
import type { CreateDeploymentV2 } from "#shared/model/contract.ts";
import {
  configurationRevision,
  environment,
  version,
  type Transaction,
} from "#infrastructure/delivery-data.ts";
import { lock, required, wire } from "#infrastructure/delivery-records.ts";
import { requireRollbackCandidate } from "./candidates.ts";
import { declaredComponents } from "#infrastructure/composition/automatic.ts";

/** The frozen inputs a request selects (model 4.9). */
export type FrozenSelection = {
  versionSet: VersionSetRevision;
  pipeline: PipelineRevision;
  configuration: Awaited<ReturnType<typeof configurationRevision>>;
  restoredDeploymentId: string | null;
  sourceEnvironmentId: string | null;
  /** Reasons the selected set revision is not eligible (4.12); empty when it is. */
  ineligible: string[];
};

async function pipelineRevision(tx: Transaction, id: string) {
  return PipelineRevisionSchema.parse(
    wire(required(await tx.pipeline.findUnique({ where: { id } }), "Recipe")),
  );
}

async function acceptedDeployment(tx: Transaction, env: Environment) {
  return env.acceptedDeploymentId === null
    ? null
    : required(
        await tx.deployment.findUnique({
          where: { id: env.acceptedDeploymentId },
        }),
        "Accepted deployment",
      );
}

/**
 * The recipe and configuration a deploy or promote carries: the accepted
 * selection's, or the declared binding while nothing is accepted (E0). A
 * newer declared revision reaches the environment only through `rebind`.
 */
async function currentBinding(tx: Transaction, env: Environment) {
  const accepted = await acceptedDeployment(tx, env);
  return {
    recipeId: accepted?.pipelineRevisionId ?? env.pipelineRevisionId,
    configurationId: accepted?.configurationId ?? env.declaredConfigurationId,
  };
}

/** Eligibility of a set revision for deploy and promote (4.12, K1, R5). */
async function eligibility(
  tx: Transaction,
  env: Environment,
  selected: VersionSetRevision,
): Promise<string[]> {
  const service = required(
    await tx.service.findUnique({ where: { id: env.serviceId } }),
    "Service",
  );
  const reasons: string[] = [];
  if (selected.lineage !== service.lineage)
    reasons.push(
      `set revision ${String(selected.revision)} is from a previous lineage (R5)`,
    );
  const components = new Set(Object.keys(selected.components));
  const declared = declaredComponents(service.components);
  const missing = declared.filter((name) => !components.has(name));
  if (missing.length > 0)
    reasons.push(`set revision lacks ${missing.join(", ")} (K1)`);
  if (env.promotionSourceEnvironmentId !== null) {
    // Only the source's current, settled acceptance is eligible, never one
    // it has since replaced or one whose monitor alarmed (4.12, W3).
    const refused = await sourceRefusal(
      tx,
      env.promotionSourceEnvironmentId,
      env.serviceId,
      selected.id,
    );
    if (refused !== null) reasons.push(refused.reason);
  }
  return reasons;
}

/**
 * A promotion source's current acceptance: the set revision it accepted, in
 * the form this service selects it (section 7), and whether its monitor has
 * settled (M2, W3). Null when the source has accepted nothing.
 */
async function sourceAcceptance(
  tx: Transaction,
  sourceId: string,
  serviceId: string,
) {
  const accepted = await acceptedDeployment(
    tx,
    await environment(tx, sourceId),
  );
  if (accepted === null) return null;
  return {
    versionSetId: await carriedSetId(
      tx,
      accepted.versionSetRevisionId,
      serviceId,
    ),
    monitorState: accepted.monitorState,
    settled:
      accepted.monitorState === "settled" ||
      accepted.monitorState === "unmonitored",
  };
}

function unsettled(
  sourceId: string,
  accepted: { monitorState: string | null },
) {
  return `${sourceId}'s accepted selection is ${accepted.monitorState ?? "unobserved"}, not settled (W3)`;
}

/**
 * Why a set revision is not the promotion source's current, settled
 * acceptance, or null when it is; `waiting` when only that acceptance's
 * monitor has yet to settle. Deploy eligibility, promote and admission share
 * this one test (4.12, M2, W3).
 */
async function sourceRefusal(
  tx: Transaction,
  sourceId: string,
  serviceId: string,
  versionSetId: string,
): Promise<{ reason: string; waiting: boolean } | null> {
  const accepted = await sourceAcceptance(tx, sourceId, serviceId);
  if (accepted === null)
    return { reason: `${sourceId} has no accepted selection`, waiting: false };
  if (accepted.versionSetId !== versionSetId)
    return {
      reason: `set revision is not ${sourceId}'s accepted selection`,
      waiting: false,
    };
  if (accepted.settled) return null;
  return {
    reason: unsettled(sourceId, accepted),
    waiting: accepted.monitorState !== "alarmed",
  };
}

async function acceptedIdOf(tx: Transaction, environmentId: string) {
  const row = await environment(tx, environmentId);
  return row.acceptedDeploymentId;
}

/**
 * Admission holds the source's accepted deployment under the lock a monitor
 * observation takes (W1), so the acceptance and monitor state it reads next
 * cannot change before admission commits. Admission already holds
 * `delivery:claim`, which every acceptance change takes, and its own
 * deployment and environment. The source's acceptance belongs to another
 * environment, and every transaction that holds a deployment lock takes at
 * most that deployment's own environment after it, so this wait closes no
 * lock cycle.
 */
async function holdSourceAcceptance(tx: Transaction, sourceId: string) {
  let held: string | null = null;
  let accepted = await acceptedIdOf(tx, sourceId);
  while (accepted !== null && accepted !== held) {
    await lock(tx, `deployment:${accepted}`);
    held = accepted;
    accepted = await acceptedIdOf(tx, sourceId);
  }
}

/** The kinds whose plain request is gated by eligibility (4.12, H4). */
const ELIGIBILITY_GATED = new Set([
  "deploy",
  "channel-publish",
  "operator-run",
]);

/**
 * A promote always takes its source's acceptance; a plain deploy-like
 * request was admitted through eligibility, while an approved override
 * already decided on an ineligible set (H4) and is not rechecked.
 */
async function sourceGated(tx: Transaction, row: { id: string; kind: string }) {
  if (row.kind === "promote") return true;
  if (!ELIGIBILITY_GATED.has(row.kind)) return false;
  const approval = await tx.approval.findUnique({
    where: { deploymentId: row.id },
    select: { override: true },
  });
  return approval?.override !== true;
}

/**
 * M2 at admission: a queued promote, or a deploy eligible only through its
 * promotion source, still takes that source's current, settled acceptance.
 * While that acceptance's monitor has yet to settle the deployment stays
 * queued (Z1); a source that replaced the set, accepted nothing or alarmed
 * made the frozen inputs stale, and the reason is returned.
 */
export async function staleSource(
  tx: Transaction,
  row: {
    id: string;
    kind: string;
    versionSetRevisionId: string;
    sourceEnvironmentId: string | null;
  },
  env: Environment,
) {
  const sourceId = env.promotionSourceEnvironmentId;
  if (row.kind === "promote" && row.sourceEnvironmentId !== sourceId)
    return `${env.id} no longer promotes from ${row.sourceEnvironmentId ?? "no source"}; request a new deployment (M2)`;
  if (sourceId === null || !(await sourceGated(tx, row))) return null;
  await holdSourceAcceptance(tx, sourceId);
  const refused = await sourceRefusal(
    tx,
    sourceId,
    env.serviceId,
    row.versionSetRevisionId,
  );
  if (refused === null) return null;
  if (refused.waiting)
    throw new DeliveryError(
      "BUSY",
      `${refused.reason}; the deployment stays queued (M2)`,
    );
  return `Deployment inputs are stale: ${refused.reason}; request a new deployment (M2)`;
}

/** The source's accepted selection must be settled before it promotes (M2, W3). */
async function promotionSource(
  tx: Transaction,
  env: Environment,
  sourceId: string | undefined,
) {
  if (sourceId === undefined || env.promotionSourceEnvironmentId !== sourceId)
    throw new DeliveryError(
      "INVALID",
      `Promotion into ${env.id} takes the accepted selection of ${env.promotionSourceEnvironmentId ?? "no source"}`,
    );
  const accepted = await sourceAcceptance(tx, sourceId, env.serviceId);
  if (accepted === null)
    throw new DeliveryError(
      "CONFLICT",
      `${sourceId} has no accepted selection to promote`,
    );
  if (!accepted.settled)
    throw new DeliveryError("CONFLICT", unsettled(sourceId, accepted));
  return accepted.versionSetId;
}

async function rebindSelection(
  tx: Transaction,
  input: CreateDeploymentV2,
  env: Environment,
) {
  const accepted = await acceptedDeployment(tx, env);
  if (accepted === null)
    throw new DeliveryError(
      "CONFLICT",
      `${env.id} has no accepted selection to rebind`,
    );
  // The catalog is the authority for candidates: a rebind moves to the
  // declared revisions (section 6, configuration or recipe change).
  if (
    (input.recipeRevisionId !== undefined &&
      input.recipeRevisionId !== env.pipelineRevisionId) ||
    (input.configurationRevisionId !== undefined &&
      input.configurationRevisionId !== env.declaredConfigurationId)
  )
    throw new DeliveryError(
      "INVALID",
      `Rebind moves ${env.id} to its declared recipe ${env.pipelineRevisionId} and configuration ${env.declaredConfigurationId}`,
    );
  const recipeId = input.recipeRevisionId ?? accepted.pipelineRevisionId;
  const configurationId =
    input.configurationRevisionId ?? accepted.configurationId;
  if (
    recipeId === accepted.pipelineRevisionId &&
    configurationId === accepted.configurationId
  )
    throw new DeliveryError(
      "CONFLICT",
      `${env.id} already runs recipe ${recipeId} with configuration ${configurationId}`,
    );
  return {
    versionSetId: accepted.versionSetRevisionId,
    recipeId,
    configurationId,
  };
}

/**
 * Section 7: a v1 set revision the catalog carried for this service is
 * selected in its carried form, under the component names and owners the
 * catalog declares; every other set revision is selected as it is.
 */
async function carriedSetId(
  tx: Transaction,
  versionSetId: string,
  serviceId: string,
) {
  const carried = await tx.versionSet.findUnique({
    where: {
      migratedFromId_serviceId: { migratedFromId: versionSetId, serviceId },
    },
    select: { id: true },
  });
  return carried?.id ?? versionSetId;
}

async function frozen(
  tx: Transaction,
  env: Pick<Environment, "serviceId">,
  ids: { versionSetId: string; recipeId: string; configurationId: string },
) {
  return {
    versionSet: await version(
      tx,
      await carriedSetId(tx, ids.versionSetId, env.serviceId),
    ),
    pipeline: await pipelineRevision(tx, ids.recipeId),
    configuration: await configurationRevision(tx, ids.configurationId),
  };
}

/**
 * The selection a model request freezes: `deploy` names a set revision,
 * `promote` takes the source's accepted one, `rollback` restores the named
 * deployment's selection in full, `rebind` keeps the accepted set revision
 * under the declared recipe or configuration (4.9, 4.12, L2, P2).
 */
export async function selectDeployment(
  tx: Transaction,
  input: CreateDeploymentV2,
  env: Environment,
): Promise<FrozenSelection> {
  switch (input.kind) {
    case "deploy":
    case "channel-publish":
    case "operator-run": {
      const binding = await currentBinding(tx, env);
      const selected = await frozen(tx, env, {
        versionSetId: required(
          input.versionSetRevisionId ?? null,
          "Set revision",
        ),
        ...binding,
      });
      return {
        ...selected,
        restoredDeploymentId: null,
        sourceEnvironmentId: null,
        ineligible: await eligibility(tx, env, selected.versionSet),
      };
    }
    case "promote": {
      const versionSetId = await promotionSource(
        tx,
        env,
        input.sourceEnvironmentId,
      );
      const selected = await frozen(tx, env, {
        versionSetId,
        ...(await currentBinding(tx, env)),
      });
      const reasons = await eligibility(tx, env, selected.versionSet);
      if (reasons.length > 0)
        throw new DeliveryError(
          "INVALID",
          `Promotion is not eligible: ${reasons.join("; ")}`,
        );
      return {
        ...selected,
        restoredDeploymentId: null,
        sourceEnvironmentId: input.sourceEnvironmentId ?? null,
        ineligible: [],
      };
    }
    case "rollback": {
      const restoredId = required(
        input.selectionDeploymentId ?? null,
        "Restored deployment",
      );
      await requireRollbackCandidate(tx, env.id, restoredId);
      const restored = required(
        await tx.deployment.findUnique({ where: { id: restoredId } }),
        "Restored deployment",
      );
      // A rollback restores the selection exactly as frozen, a previous
      // lineage included (R5, P2).
      return {
        ...(await frozen(tx, env, {
          versionSetId: restored.versionSetRevisionId,
          recipeId: restored.pipelineRevisionId,
          configurationId: restored.configurationId,
        })),
        restoredDeploymentId: restored.id,
        sourceEnvironmentId: null,
        ineligible: [],
      };
    }
    case "rebind":
      return {
        ...(await frozen(tx, env, await rebindSelection(tx, input, env))),
        restoredDeploymentId: null,
        sourceEnvironmentId: null,
        ineligible: [],
      };
    case "retire-host":
      throw new DeliveryError(
        "INVALID",
        "A retained host retires through the worker retirement request",
      );
  }
}

/** A recipe kind takes its matching deployment kind. */
export function requireKindForRecipe(
  kind: CreateDeploymentV2["kind"],
  pipeline: PipelineRevision,
) {
  const recipeKind = pipeline.definition.kind;
  const needs =
    recipeKind === "channel"
      ? "channel-publish"
      : recipeKind === "operator-run"
        ? "operator-run"
        : null;
  if (
    (needs !== null && kind === "deploy") ||
    (kind !== needs && (kind === "channel-publish" || kind === "operator-run"))
  )
    throw new DeliveryError(
      "INVALID",
      `A ${recipeKind} recipe is realised by ${needs ?? "deploy"}, not ${kind}`,
    );
}
