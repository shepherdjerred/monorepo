import { z } from "zod";
import { Prisma } from "#generated/prisma/client.ts";
import { DeliveryError } from "#domain/error.ts";
import type { Principal } from "#shared/contract.ts";
import { PipelineRevisionSchema } from "#shared/contract.ts";
import {
  ColdStartReceiptSchema,
  ColdStartSnapshotSchema,
  RestoreHoldSchema,
  SettleRestoreHoldSchema,
  type ColdStartReceipt,
  type SettleRestoreHold,
} from "#shared/model/cold-start-contract.ts";
import {
  ReconcileAfterRestoreRequestSchema,
  ReconcileAfterRestoreSchema,
  type ReconcileAfterRestoreRequest,
} from "#shared/model/route-contract.ts";
import type { Selection } from "#shared/model/selection-contract.ts";
import { applicationsOf } from "#shared/model/recipe-view.ts";
import { stepStageKey } from "#shared/model/stage-keys.ts";
import { requireScope } from "#infrastructure/auth.ts";
import type { Delivery } from "#infrastructure/delivery.ts";
import {
  evidence,
  id,
  type Transaction,
} from "#infrastructure/delivery-data.ts";
import {
  audit,
  fingerprint,
  lock,
  wire,
} from "#infrastructure/delivery-records.ts";
import type { ApplicationReader } from "#infrastructure/kubernetes/application-reader.ts";
import {
  CONVERGING_STAGES,
  bootstrapChain,
  coldStartSnapshot,
  frozenSelection,
} from "./snapshot.ts";

/** Whether this acceptance moves the bootstrap chain, with the snapshot to write. */
export async function coldStartRequirement(
  this: Delivery,
  deploymentId: string,
) {
  const row = await this.database.deployment.findUniqueOrThrow({
    where: { id: deploymentId },
  });
  const env = await this.database.environment.findUniqueOrThrow({
    where: { id: row.environmentId },
  });
  if (env.acceptedDeploymentId !== row.id) return { required: false as const };
  const chain = await bootstrapChain(this.database);
  if (!chain.includes(env.id)) return { required: false as const };
  const { snapshot, fingerprint: digest } = await this.database.$transaction(
    async (tx) => {
      await lock(tx, "cold-start:snapshot");
      return coldStartSnapshot(tx, await snapshotClock(tx));
    },
  );
  return { required: true as const, fingerprint: digest, snapshot };
}

/**
 * The database clock to the microsecond. Snapshots are built one at a time
 * under `cold-start:snapshot`, each reading this clock and then the record,
 * so a later snapshot carries a later `writtenAt` and read a record at least
 * as new. The writer orders snapshots by it (X7).
 */
async function snapshotClock(tx: Transaction): Promise<string> {
  const rows = await tx.$queryRaw<
    { at: string }[]
  >`SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS at`;
  const [row] = rows;
  if (row === undefined) throw new Error("The database clock returned no row");
  return row.at;
}

/** The executor wrote the snapshot off-cluster; the receipt is the acceptance's backup evidence. */
export async function recordColdStartReceipt(
  this: Delivery,
  deploymentId: string,
  raw: ColdStartReceipt,
  actor: Principal,
) {
  requireScope(actor, "execute");
  const receipt = ColdStartReceiptSchema.parse(raw);
  await this.database.$transaction(async (tx) => {
    await lock(tx, `deployment:${deploymentId}`);
    await evidence(
      tx,
      deploymentId,
      [
        {
          kind: "backup",
          operationId: receipt.fingerprint,
          summary: JSON.stringify({ adapter: "cold-start", ...receipt }),
        },
      ],
      { prefix: "cold-start", appendOnly: true },
    );
  });
  return receipt;
}

const ApplicationOperation = z.object({
  status: z
    .object({
      operationState: z
        .object({
          operation: z.object({
            info: z
              .array(z.object({ name: z.string(), value: z.string() }))
              .default([]),
          }),
        })
        .optional(),
    })
    .optional(),
});

/**
 * What the live target shows: the selection that last synced each of the
 * recipe's Applications, one of them absent, or nothing observable for its
 * kind (a recipe with no Application).
 */
type Live =
  | { kind: "selection"; selections: (Selection | null)[] }
  | { kind: "missing" }
  | { kind: "not-observed" };

/** A sync step's stage: v1's reconcile, or the sync of a recipe or of a compound sub-recipe (`subN-step-sync`). */
const SYNC_STAGE = stepStageKey("step", "sync");
const SYNCED_BY = {
  OR: [
    { key: { in: [...CONVERGING_STAGES] } },
    { key: { endsWith: `-${SYNC_STAGE}` } },
  ],
};

/** The selection of the deployment whose request last synced one Application. */
async function syncedSelection(
  this: Delivery,
  raw: unknown,
): Promise<Selection | null> {
  const request = (
    ApplicationOperation.parse(raw).status?.operationState?.operation.info ?? []
  ).find((entry) => entry.name === "ci.sjer.red/request-id");
  if (request === undefined) return null;
  const stage = await this.database.stage.findFirst({
    where: { operationId: request.value, ...SYNCED_BY },
    include: { deployment: true },
  });
  if (stage === null) return null;
  // Section 7: a catalog carry re-identifies the selection that synced the
  // target without syncing it again, so that sync stands for the carry.
  const carry = await this.database.deployment.findFirst({
    where: {
      kind: "carry",
      status: "succeeded",
      previousAcceptedDeploymentId: stage.deployment.id,
    },
  });
  return frozenSelection(carry ?? stage.deployment);
}

/**
 * Live readback through the projected reader (D5): for every Application
 * the environment's recipe declares, compound members included, the
 * selection of the deployment whose request last synced it.
 */
async function observeLive(
  this: Delivery,
  readApplication: ApplicationReader | undefined,
  recipeRevisionId: string | null,
): Promise<Live> {
  if (readApplication === undefined || recipeRevisionId === null)
    return { kind: "not-observed" };
  const recipe = PipelineRevisionSchema.parse(
    wire(
      await this.database.pipeline.findUniqueOrThrow({
        where: { id: recipeRevisionId },
      }),
    ),
  );
  const applications = applicationsOf(recipe.definition);
  if (applications.length === 0) return { kind: "not-observed" };
  const selections: (Selection | null)[] = [];
  for (const application of applications) {
    const raw = await readApplication(application.name);
    if (raw === null) return { kind: "missing" };
    selections.push(await syncedSelection.call(this, raw));
  }
  return { kind: "selection", selections };
}

function sameSelection(left: Selection | null, right: Selection | null) {
  return fingerprint(left) === fingerprint(right);
}

/** The live selection reported for an environment: one that differs from the record, else the agreed one. */
function liveSelection(record: Selection | null, live: Live) {
  if (live.kind !== "selection") return null;
  const differing = live.selections.filter(
    (selection) => !sameSelection(selection, record),
  );
  return (differing.length > 0 ? differing : live.selections)[0] ?? null;
}

function mismatch(
  record: Selection | null,
  snapshot: Selection | null,
  live: Live,
): string | null {
  if (!sameSelection(record, snapshot))
    return "The record's accepted selection differs from the cold-start snapshot's";
  if (live.kind === "missing") return "The live target does not exist";
  return live.kind === "selection" &&
    live.selections.some((selection) => !sameSelection(selection, record))
    ? "The live target was last synced by another selection than the record accepts"
    : null;
}

export type RestoreDependencies = {
  readSnapshot: () => Promise<unknown>;
  readApplication?: ApplicationReader;
};

async function holdEnvironment(
  this: Delivery,
  environmentId: string,
  input: { reason: string; catalogRevision: string; requestId: string },
  actor: Principal,
) {
  await this.database.$transaction(async (tx) => {
    await lock(tx, `environment:${environmentId}`);
    await tx.environment.update({
      where: { id: environmentId },
      data: {
        restoreHold: RestoreHoldSchema.parse({
          catalogRevision: input.catalogRevision,
          reason: input.reason,
          heldAt: new Date().toISOString(),
        }),
      },
    });
    await audit(tx, actor, {
      action: "environment.restore_held",
      entityId: environmentId,
      requestId: input.requestId,
      metadata: input,
    });
  });
}

/**
 * Section 6: compare record, cold-start snapshot and live target for every
 * active environment and hold automatic deployments on each mismatch until
 * an operator accepts the live state with evidence or a deployment is
 * accepted there. Never moves an accepted pointer (X7).
 */
export async function reconcileAfterRestore(
  this: Delivery,
  raw: ReconcileAfterRestoreRequest,
  actor: Principal,
  dependencies: RestoreDependencies,
) {
  requireScope(actor, "admin");
  const request = ReconcileAfterRestoreRequestSchema.parse(raw);
  const snapshot = ColdStartSnapshotSchema.parse(
    await dependencies.readSnapshot(),
  );
  const fromSnapshot = new Map(
    snapshot.environments.map((env) => [env.environmentId, env.selection]),
  );
  const environments = await this.database.environment.findMany({
    where: { lifecycle: "active" },
    include: { acceptedDeployment: true },
    orderBy: { id: "asc" },
  });
  const comparisons = [];
  for (const env of environments) {
    const record =
      env.acceptedDeployment === null
        ? null
        : frozenSelection(env.acceptedDeployment);
    const snapshotSelection = fromSnapshot.get(env.id) ?? null;
    const live = await observeLive.call(
      this,
      dependencies.readApplication,
      env.acceptedDeployment?.pipelineRevisionId ?? null,
    );
    const reason = mismatch(record, snapshotSelection, live);
    if (reason !== null)
      await holdEnvironment.call(
        this,
        env.id,
        {
          reason,
          catalogRevision: snapshot.catalogRevision,
          requestId: request.requestId,
        },
        actor,
      );
    comparisons.push({
      id: env.id,
      record,
      snapshot: snapshotSelection,
      live: liveSelection(record, live),
      ...(reason === null
        ? { status: "match" as const }
        : { status: "held" as const, reason }),
    });
  }
  return ReconcileAfterRestoreSchema.parse({ environments: comparisons });
}

/** An operator accepts the live state after a restore with evidence; the hold clears. */
export async function settleRestoreHold(
  this: Delivery,
  environmentId: string,
  raw: SettleRestoreHold,
  actor: Principal,
) {
  requireScope(actor, "admin");
  const input = SettleRestoreHoldSchema.parse(raw);
  return this.database.$transaction(async (tx) => {
    await lock(tx, `environment:${environmentId}`);
    const env = await tx.environment.findUniqueOrThrow({
      where: { id: environmentId },
    });
    if (env.restoreHold === null)
      throw new DeliveryError(
        "CONFLICT",
        "Environment holds no restore mismatch",
      );
    const hold = RestoreHoldSchema.parse(env.restoreHold);
    if (env.acceptedDeploymentId !== null)
      await evidence(
        tx,
        env.acceptedDeploymentId,
        [
          {
            kind: "reconciliation",
            summary: JSON.stringify({
              adapter: "reconcile-after-restore",
              catalogRevision: hold.catalogRevision,
              reason: input.reason,
              evidence: input.evidence,
            }),
          },
        ],
        { prefix: "restore", appendOnly: true },
      );
    await tx.environment.update({
      where: { id: environmentId },
      data: { restoreHold: Prisma.DbNull },
    });
    await audit(tx, actor, {
      action: "environment.restore_accepted",
      entityId: environmentId,
      requestId: id(),
      metadata: { hold, reason: input.reason },
    });
    return { environmentId, cleared: hold };
  });
}
