import { RevisionIdSchema } from "@shepherdjerred/ops-model/catalog-document-shape.ts";
import type { Principal } from "#shared/contract.ts";
import type { StoredRecipeDefinition } from "#shared/model/record-contract.ts";
import { fingerprint } from "#infrastructure/delivery-records.ts";
import type { Delivery } from "#infrastructure/delivery.ts";
import {
  lastTerminalId,
  submitAutomatic,
  supersedeQueuedAutomatic,
} from "#infrastructure/delivery-selection.ts";

type EnvironmentRow = Awaited<
  ReturnType<Delivery["database"]["environment"]["findMany"]>
>[number];

type LastDeploymentRow = {
  id: string;
  status: string;
  versionSetRevisionId: string;
  pipelineRevisionId: string;
  configurationId: string;
} | null;

async function rebindVersionSetId(
  database: Delivery["database"],
  acceptedVersionSetId: string,
  serviceId: string,
) {
  const carried = await database.versionSet.findUnique({
    where: {
      migratedFromId_serviceId: {
        migratedFromId: acceptedVersionSetId,
        serviceId,
      },
    },
    select: { id: true },
  });
  return carried?.id ?? acceptedVersionSetId;
}

async function automaticRebindBlocked(
  this: Delivery,
  input: {
    row: EnvironmentRow;
    accepted: {
      id: string;
      kind: string;
      catalogRevision: string;
      createdAt: Date;
    };
    versionSetId: string;
    last: LastDeploymentRow;
  },
  actor: Principal,
) {
  const { row, accepted, versionSetId, last } = input;
  if (accepted.kind === "rollback") {
    if (row.catalogRevision === accepted.catalogRevision) return true;
    const reverted = await this.database.deployment.findFirst({
      where: {
        environmentId: row.id,
        pipelineRevisionId: row.pipelineRevisionId,
        configurationId: row.declaredConfigurationId,
        createdAt: { lt: accepted.createdAt },
      },
      select: { id: true },
    });
    if (reverted !== null) return true;
  }
  if (last !== null && ["queued", "awaiting_approval"].includes(last.status)) {
    const matches =
      last.versionSetRevisionId === versionSetId &&
      last.pipelineRevisionId === row.pipelineRevisionId &&
      last.configurationId === row.declaredConfigurationId;
    const label = `${row.pipelineRevisionId}@${row.declaredConfigurationId}`;
    if (
      matches ||
      !(await supersedeQueuedAutomatic.call(this, last.id, label, actor))
    )
      return true;
  }
  const tried = await this.database.deployment.findFirst({
    where: {
      environmentId: row.id,
      status: { in: ["failed", "canceled"] },
      versionSetRevisionId: versionSetId,
      pipelineRevisionId: row.pipelineRevisionId,
      configurationId: row.declaredConfigurationId,
      OR: [
        { previousAcceptedDeploymentId: accepted.id },
        { createdAt: { gt: accepted.createdAt } },
      ],
    },
    select: { id: true },
  });
  return tried !== null;
}

async function requestAutomaticRebind(
  this: Delivery,
  row: EnvironmentRow,
  target: { versionSetId: string; recipeMoved: boolean; configMoved: boolean },
  actor: Principal,
) {
  const after = await lastTerminalId(this.database, row.id);
  const requestId = `automatic/rebind/${fingerprint({
    environmentId: row.id,
    versionSetId: target.versionSetId,
    recipe: row.pipelineRevisionId,
    config: row.declaredConfigurationId,
    after,
  })}`;
  return submitAutomatic(
    this,
    {
      requestId,
      environmentId: row.id,
      expectedGeneration: row.generation,
      kind: "rebind",
      ...(target.recipeMoved
        ? { recipeRevisionId: row.pipelineRevisionId }
        : {}),
      ...(target.configMoved
        ? { configurationRevisionId: row.declaredConfigurationId }
        : {}),
    },
    actor,
  );
}

/**
 * When no newer set revision is eligible, an automatic environment whose
 * declared recipe or configuration moved ahead of its accepted selection
 * requests an automatic `rebind` (C3, 4.12).
 */
export async function reconcileAutomaticRebind(
  this: Delivery,
  input: {
    row: EnvironmentRow;
    definition: StoredRecipeDefinition;
    last: LastDeploymentRow;
  },
  actor: Principal,
) {
  const { row, definition, last } = input;
  if (
    !row.automatic ||
    row.acceptedDeploymentId === null ||
    definition.kind === "operator-run" ||
    definition.kind === "manual"
  )
    return null;
  const accepted = await this.database.deployment.findUniqueOrThrow({
    where: { id: row.acceptedDeploymentId },
  });
  const recipeMoved = accepted.pipelineRevisionId !== row.pipelineRevisionId;
  const configMoved = accepted.configurationId !== row.declaredConfigurationId;
  if (
    (!recipeMoved && !configMoved) ||
    (recipeMoved &&
      !RevisionIdSchema.safeParse(row.pipelineRevisionId).success) ||
    (configMoved &&
      !RevisionIdSchema.safeParse(row.declaredConfigurationId).success)
  )
    return null;
  const versionSetId = await rebindVersionSetId(
    this.database,
    accepted.versionSetRevisionId,
    row.serviceId,
  );
  return (await automaticRebindBlocked.call(
    this,
    { row, accepted, versionSetId, last },
    actor,
  ))
    ? null
    : requestAutomaticRebind.call(
        this,
        row,
        { versionSetId, recipeMoved, configMoved },
        actor,
      );
}
