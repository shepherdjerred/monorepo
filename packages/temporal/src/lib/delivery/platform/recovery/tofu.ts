import { createHash } from "node:crypto";
import { chmod } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  PlatformRecoveryPlanReceiptSchema,
  RecordPlatformRecoveryPlanSchema,
  RecordTofuPlanSchema,
  type PlatformRecoveryContext,
  type PlatformReleaseSnapshot,
  type TofuPlanReceipt,
} from "@shepherdjerred/delivery/contract";
import { stepStageKey } from "@shepherdjerred/delivery/model-contract";
import { canonicalJson } from "homelab/scripts/canonical-json.ts";
import {
  withDeliveryTofuStack,
  deliveryTofuChanges,
  privateProviderJson,
  type DeliveryTofuContext,
} from "homelab/scripts/tofu/delivery-stack.ts";
import {
  encryptRecoveryPlan,
  decryptRecoveryPlan,
  decryptDeliveryPlan,
} from "#lib/delivery/platform/plan-crypto.ts";
import {
  requireOriginalDiscordTarget,
  readDiscordApplications,
} from "./tofu-original.ts";
import { deliveryRequest } from "#lib/delivery/client.ts";
import { requireModelRecipe } from "#lib/delivery/model/recipe.ts";
import {
  modelTofuDesiredState,
  modelTofuSource,
} from "#lib/delivery/model/tofu.ts";
import { tofuStackOptions } from "#lib/delivery/platform/tofu-input.ts";
import type { DeliveryJobReceipt } from "#shared/delivery-job.ts";
import type { RecoveryAction } from "./request.ts";
type Snapshot = Extract<
  PlatformReleaseSnapshot,
  { kind: "tofu-plan" | "tofu-apply" }
>;
/**
 * The frozen OpenTofu source a recovery observes, plans and applies from: a
 * v1 platform snapshot, or a model tofu recipe's stack archive (X8).
 */
export type TofuRecoveryTarget = {
  /** `tofu-plan` was read-only; `tofu-apply` settles only at its desired source. */
  kind: "tofu-plan" | "tofu-apply";
  stack: string;
  sourceBuildId: string;
  sourceRevision: string;
  /** The original saved plan, whose state lineage and serial bound recovery; null when none was saved. */
  plan: TofuPlanReceipt | null;
  /** v1 only: the frozen apply a Discord original-target baseline reads. */
  legacy?: Extract<Snapshot, { kind: "tofu-apply" }>;
};
/** A v1 platform snapshot as a recovery target. */
export function legacyTofuTarget(snapshot: Snapshot): TofuRecoveryTarget {
  return {
    kind: snapshot.kind,
    stack: snapshot.stack,
    sourceBuildId: snapshot.source.id,
    sourceRevision: snapshot.source.sourceRevision,
    plan: snapshot.kind === "tofu-apply" ? snapshot.plan : null,
    ...(snapshot.kind === "tofu-apply" ? { legacy: snapshot } : {}),
  };
}
type Inputs = {
  target: TofuRecoveryTarget;
  intentId: string;
  native: DeliveryJobReceipt;
  fence: () => Promise<void>;
  original?: boolean;
};
function targetChanged(
  exitCode: number,
  changes: ReturnType<typeof deliveryTofuChanges>,
) {
  return exitCode !== 0 || Object.values(changes).some((count) => count !== 0);
}
function originalTargetRequested(input: Inputs) {
  return input.original === true && input.target.stack === "discord";
}

async function applySavedRecovery(
  tofu: DeliveryTofuContext,
  input: Inputs,
  planPath: string,
) {
  const { target } = input;
  if (target.kind !== "tofu-apply")
    throw new Error(
      "Read-only plan failures cannot authorize recovery mutations",
    );
  const before = await tofu.state();
  const stored = await deliveryRequest(
    `platform-recovery/${encodeURIComponent(input.intentId)}/plan`,
    RecordPlatformRecoveryPlanSchema,
  );
  if (
    stored.receipt.recoveryIntentId !== input.intentId ||
    stored.receipt.sourceBuildId !== target.sourceBuildId ||
    stored.receipt.sourceRevision !== target.sourceRevision ||
    stored.receipt.stack !== target.stack ||
    canonicalJson(stored.receipt.state) !== canonicalJson(before)
  )
    throw new Error(
      "Recovery plan is not bound to this exact intent, source and current native state",
    );
  const bytes = decryptRecoveryPlan(
    stored,
    z.string().parse(Bun.env["DELIVERY_PLAN_ENCRYPTION_PASSPHRASE"]),
  );
  await Bun.write(planPath, bytes);
  await chmod(planPath, 0o600);
  await input.fence();
  await tofu.command(["apply", "-input=false", "-lock-timeout=5m", planPath]);
  const after = await tofu.state();
  if (after.lineage !== before.lineage || after.serial < before.serial)
    throw new Error("Recovery apply changed remote state identity");
  return {
    outcome: "applied-recovery-plan",
    planDigest: stored.receipt.planDigest,
    state: after,
  };
}

async function saveRecoveryPlan(
  tofu: DeliveryTofuContext,
  input: Inputs,
  planPath: string,
  changes: ReturnType<typeof deliveryTofuChanges>,
) {
  const { target } = input;
  if (target.kind !== "tofu-apply")
    throw new Error(
      "Read-only plan failures cannot authorize recovery mutations",
    );
  const file = Bun.file(planPath);
  if (file.size === 0 || file.size > 8 * 1024 * 1024)
    throw new Error("Recovery saved plan exceeds its private byte bound");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const createdAt = new Date();
  const receipt = PlatformRecoveryPlanReceiptSchema.parse({
    schema: "delivery-tofu-recovery-plan/v1",
    recoveryIntentId: input.intentId,
    sourceBuildId: target.sourceBuildId,
    sourceRevision: target.sourceRevision,
    stack: target.stack,
    createdAt: createdAt.toISOString(),
    expiresAt: new Date(createdAt.getTime() + 24 * 60 * 60_000).toISOString(),
    planDigest: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
    state: await tofu.state(),
    changes,
    nativeJob: input.native,
  });
  return encryptRecoveryPlan(
    receipt,
    bytes,
    z.string().parse(Bun.env["DELIVERY_PLAN_ENCRYPTION_PASSPHRASE"]),
  );
}

async function inspectOriginalTarget(
  tofu: DeliveryTofuContext,
  snapshot: Extract<Snapshot, { kind: "tofu-apply" }>,
  before: Awaited<ReturnType<DeliveryTofuContext["state"]>>,
  currentPlan: unknown,
) {
  const saved = await deliveryRequest(
    `platform/plans/${encodeURIComponent(snapshot.planDeploymentId)}`,
    RecordTofuPlanSchema,
  );
  if (canonicalJson(saved.receipt) !== canonicalJson(snapshot.plan))
    throw new Error(
      "Original approved plan receipt differs from the frozen apply",
    );
  const originalPath = path.join(tofu.workspace, "original.tfplan");
  await Bun.write(
    originalPath,
    decryptDeliveryPlan(
      saved,
      z.string().parse(Bun.env["DELIVERY_PLAN_ENCRYPTION_PASSPHRASE"]),
    ),
    { mode: 0o600 },
  );
  const shown = await tofu.command(["show", "-json", originalPath]);
  const nativeBefore = requireOriginalDiscordTarget(
    privateProviderJson(shown.stdout),
    currentPlan,
    await readDiscordApplications(),
  );
  if (canonicalJson(await tofu.state()) !== canonicalJson(before))
    throw new Error("Remote state changed during original-baseline inspection");
  return {
    state: "original",
    observedAt: new Date().toISOString(),
    proofSummary: `Original target from authenticated saved plan ${snapshot.plan.planDigest}; same lineage ${before.lineage}, original serial ${String(snapshot.plan.state.serial)}, stable current serial ${String(before.serial)}; complete managed before and independent application values match baseline ${nativeBefore}; state history and acceptance unchanged by this settlement`,
  };
}

/**
 * A model tofu deployment as a recovery target: its frozen stack archive,
 * the plan its plan step saved (an apply exists only after one), and
 * forward convergence to that source (`tofu-apply`).
 */
async function modelRecoveryTarget(
  detail: PlatformRecoveryContext["deployment"],
): Promise<TofuRecoveryTarget> {
  const recipe = requireModelRecipe(detail);
  if (recipe.kind !== "tofu")
    throw new Error("Recovery has no frozen OpenTofu source");
  const source = modelTofuSource(detail, recipe);
  const planned = detail.stages.some(
    (stage) =>
      stage.key === stepStageKey("step", "plan") &&
      stage.status === "succeeded",
  );
  const saved = planned
    ? await deliveryRequest(
        `platform/plans/${encodeURIComponent(detail.deployment.id)}`,
        RecordTofuPlanSchema,
      )
    : null;
  return {
    kind: "tofu-apply",
    stack: recipe.stack,
    sourceBuildId: source.sourceBuildId,
    sourceRevision: source.sourceRevision,
    plan: saved?.receipt ?? null,
  };
}

/**
 * The frozen source a recovery runs from, and the extracted stack archive
 * directory and frozen desired state a model recipe's Job stages (X8); a v1
 * snapshot uses the checked-out source.
 */
async function recoverySource(context: PlatformRecoveryContext) {
  const snapshot = context.deployment.deployment.platformSnapshot;
  if (snapshot?.kind === "tofu-plan" || snapshot?.kind === "tofu-apply")
    return { target: legacyTofuTarget(snapshot), options: {} };
  if (snapshot !== null)
    throw new Error("Recovery has no frozen OpenTofu source");
  const recipe = requireModelRecipe(context.deployment);
  if (recipe.kind !== "tofu")
    throw new Error("Recovery has no frozen OpenTofu source");
  return {
    target: await modelRecoveryTarget(context.deployment),
    options: tofuStackOptions({
      archive: modelTofuSource(context.deployment, recipe).archive,
      desiredState: modelTofuDesiredState(context.deployment),
    }),
  };
}

/** All commands use the original frozen source and fixed stack; provider output and plan bytes remain private. */
export async function runTofuRecovery(
  context: PlatformRecoveryContext,
  action: RecoveryAction,
  native: DeliveryJobReceipt,
  fence: () => Promise<void>,
) {
  const { target, options } = await recoverySource(context);
  return await withDeliveryTofuStack(
    target.stack,
    async (tofu) =>
      await runTofuRecoveryInWorkspace(
        {
          target,
          intentId: context.intent.id,
          native,
          fence,
          original: context.expectedSettlements.original !== undefined,
        },
        action,
        tofu,
      ),
    undefined,
    options,
  );
}
/** An apply's recovery acts only on the state lineage its saved plan read, at or after that serial. */
function requireSavedPlanLineage(
  target: TofuRecoveryTarget,
  before: Awaited<ReturnType<DeliveryTofuContext["state"]>>,
) {
  if (
    target.kind === "tofu-apply" &&
    target.plan !== null &&
    (before.lineage !== target.plan.state.lineage ||
      before.serial < target.plan.state.serial)
  )
    throw new Error(
      "Recovery remote state differs from the original saved-plan lineage",
    );
}

/** Injection boundary verifies actual plan bytes and provider commands without live providers. */
export async function runTofuRecoveryInWorkspace(
  input: Inputs,
  action: RecoveryAction,
  tofu: DeliveryTofuContext,
) {
  const { target } = input;
  const before = await tofu.state();
  requireSavedPlanLineage(target, before);
  const planPath = path.join(tofu.workspace, "recovery.tfplan");
  if (action === "apply") {
    return await applySavedRecovery(tofu, input, planPath);
  }
  const planned = await tofu.command(
    [
      "plan",
      "-input=false",
      "-lock-timeout=5m",
      "-detailed-exitcode",
      `-out=${planPath}`,
    ],
    [0, 2],
  );
  const rendered = await tofu.command(["show", "-json", planPath]);
  const changes = deliveryTofuChanges(privateProviderJson(rendered.stdout));
  if (canonicalJson(await tofu.state()) !== canonicalJson(before))
    throw new Error("Remote state changed during recovery observation");
  if (action === "inspect") {
    if (
      target.kind === "tofu-apply" &&
      targetChanged(planned.exitCode, changes)
    ) {
      if (originalTargetRequested(input) && target.legacy !== undefined) {
        return await inspectOriginalTarget(
          tofu,
          target.legacy,
          before,
          privateProviderJson(rendered.stdout),
        );
      }
      throw new Error(
        "OpenTofu target is partial or drifted; create and approve an exact recovery plan before settlement",
      );
    }
    return {
      state: target.kind === "tofu-plan" ? "readonly" : "desired",
      observedAt: new Date().toISOString(),
      proofSummary: `Independent fixed-source OpenTofu ${target.stack} observation; native lineage ${before.lineage}, serial ${String(before.serial)}, stable state and ${target.kind === "tofu-plan" ? "original read-only recipe" : "zero proposed changes"} verified`,
    };
  }
  return await saveRecoveryPlan(tofu, input, planPath, changes);
}
