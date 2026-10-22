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
import { required, wire } from "#infrastructure/delivery-records.ts";
import { ACCEPTING_KINDS, requireRollbackCandidate } from "./candidates.ts";
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
    const acceptedThere = await tx.deployment.count({
      where: {
        environmentId: env.promotionSourceEnvironmentId,
        versionSetRevisionId: selected.id,
        status: "succeeded",
        kind: { in: ACCEPTING_KINDS },
      },
    });
    if (acceptedThere === 0)
      reasons.push(
        `set revision was never accepted in ${env.promotionSourceEnvironmentId}`,
      );
  }
  return reasons;
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
  const source = await environment(tx, sourceId);
  const accepted = await acceptedDeployment(tx, source);
  if (accepted === null)
    throw new DeliveryError(
      "CONFLICT",
      `${sourceId} has no accepted selection to promote`,
    );
  if (
    accepted.monitorState !== "settled" &&
    accepted.monitorState !== "unmonitored"
  )
    throw new DeliveryError(
      "CONFLICT",
      `${sourceId}'s accepted selection is ${accepted.monitorState ?? "unobserved"}, not settled (W3)`,
    );
  return accepted.versionSetRevisionId;
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
