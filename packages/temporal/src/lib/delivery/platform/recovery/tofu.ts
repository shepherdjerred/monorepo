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
} from "@shepherdjerred/delivery/contract";
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
import type { DeliveryJobReceipt } from "#shared/delivery-job.ts";
import type { RecoveryAction } from "./request.ts";
type Snapshot = Extract<
  PlatformReleaseSnapshot,
  { kind: "tofu-plan" | "tofu-apply" }
>;
type Inputs = {
  snapshot: Snapshot;
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
  return input.original === true && input.snapshot.stack === "discord";
}

async function applySavedRecovery(
  tofu: DeliveryTofuContext,
  input: Inputs,
  planPath: string,
) {
  const { snapshot } = input;
  if (snapshot.kind !== "tofu-apply")
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
    stored.receipt.sourceBuildId !== snapshot.source.id ||
    stored.receipt.sourceRevision !== snapshot.source.sourceRevision ||
    stored.receipt.stack !== snapshot.stack ||
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
  const snapshot = input.snapshot;
  if (snapshot.kind !== "tofu-apply")
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
    sourceBuildId: snapshot.source.id,
    sourceRevision: snapshot.source.sourceRevision,
    stack: snapshot.stack,
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

/** All commands use the original frozen source and fixed stack; provider output and plan bytes remain private. */
export async function runTofuRecovery(
  context: PlatformRecoveryContext,
  action: RecoveryAction,
  native: DeliveryJobReceipt,
  fence: () => Promise<void>,
) {
  const snapshot = context.deployment.deployment.platformSnapshot;
  if (snapshot?.kind !== "tofu-plan" && snapshot?.kind !== "tofu-apply")
    throw new Error("Recovery has no frozen OpenTofu source");
  return await withDeliveryTofuStack(
    snapshot.stack,
    async (tofu) =>
      await runTofuRecoveryInWorkspace(
        {
          snapshot,
          intentId: context.intent.id,
          native,
          fence,
          original: context.expectedSettlements.original !== undefined,
        },
        action,
        tofu,
      ),
  );
}
/** Injection boundary verifies actual plan bytes and provider commands without live providers. */
export async function runTofuRecoveryInWorkspace(
  input: Inputs,
  action: RecoveryAction,
  tofu: DeliveryTofuContext,
) {
  const { snapshot } = input;
  const before = await tofu.state();
  if (
    snapshot.kind === "tofu-apply" &&
    (before.lineage !== snapshot.plan.state.lineage ||
      before.serial < snapshot.plan.state.serial)
  )
    throw new Error(
      "Recovery remote state differs from the original saved-plan lineage",
    );
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
      snapshot.kind === "tofu-apply" &&
      targetChanged(planned.exitCode, changes)
    ) {
      if (originalTargetRequested(input)) {
        return await inspectOriginalTarget(
          tofu,
          snapshot,
          before,
          privateProviderJson(rendered.stdout),
        );
      }
      throw new Error(
        "OpenTofu target is partial or drifted; create and approve an exact recovery plan before settlement",
      );
    }
    return {
      state: snapshot.kind === "tofu-plan" ? "readonly" : "desired",
      observedAt: new Date().toISOString(),
      proofSummary: `Independent fixed-source OpenTofu ${snapshot.stack} observation; native lineage ${before.lineage}, serial ${String(before.serial)}, stable state and ${snapshot.kind === "tofu-plan" ? "original read-only recipe" : "zero proposed changes"} verified`,
    };
  }
  return await saveRecoveryPlan(tofu, input, planPath, changes);
}
