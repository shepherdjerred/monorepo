import path from "node:path";
import { chmod } from "node:fs/promises";
import { z } from "zod";
import {
  PlatformReleaseSnapshotSchema,
  RecordTofuPlanSchema,
} from "@shepherdjerred/delivery/contract";
import { canonicalJson } from "homelab/scripts/canonical-json.ts";
import { withDeliveryTofuStack } from "homelab/scripts/tofu/delivery-stack.ts";
import { decryptDeliveryPlan } from "#lib/delivery/platform/plan-crypto.ts";
import { deliveryRequest } from "#lib/delivery/client.ts";
import type { DeliveryJobRequest } from "#shared/delivery-job.ts";
import { admitPlatformNativeJob } from "#lib/delivery/platform/native-job.ts";

/** Applying never replans: only authenticated bytes from the frozen successful plan are accepted. */
export async function run(request: DeliveryJobRequest): Promise<unknown> {
  const snapshot = PlatformReleaseSnapshotSchema.parse(request.input);
  if (
    snapshot.kind !== "tofu-apply" ||
    snapshot.source.sourceRevision !== request.sourceRevision
  )
    throw new Error("Saved apply Job differs from its exact frozen source");
  const stored = await deliveryRequest(
    `platform/plans/${encodeURIComponent(snapshot.planDeploymentId)}`,
    RecordTofuPlanSchema,
  );
  if (canonicalJson(stored.receipt) !== canonicalJson(snapshot.plan))
    throw new Error(
      "Saved plan metadata differs from the exact approved snapshot",
    );
  const bytes = decryptDeliveryPlan(
    stored,
    z.string().min(32).parse(Bun.env["DELIVERY_PLAN_ENCRYPTION_PASSPHRASE"]),
  );
  return await withDeliveryTofuStack(snapshot.stack, async (context) => {
    if (
      canonicalJson(await context.state()) !==
      canonicalJson(snapshot.plan.state)
    )
      throw new Error(
        "Saved plan state lineage or serial changed before apply",
      );
    const planPath = path.join(context.workspace, "plan.tfplan");
    await Bun.write(planPath, bytes);
    await chmod(planPath, 0o600);
    await admitPlatformNativeJob(request);
    await context.command([
      "apply",
      "-input=false",
      "-lock-timeout=5m",
      planPath,
    ]);
    const state = await context.state();
    if (
      state.lineage !== snapshot.plan.state.lineage ||
      state.serial < snapshot.plan.state.serial
    )
      throw new Error(
        "Applied plan did not preserve its recorded state lineage",
      );
    return {
      stack: snapshot.stack,
      planDeploymentId: snapshot.planDeploymentId,
      planDigest: snapshot.plan.planDigest,
      state,
      outcome: "applied-saved-plan",
    };
  });
}
