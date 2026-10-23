import path from "node:path";
import { chmod } from "node:fs/promises";
import { z } from "zod";
import { RecordTofuPlanSchema } from "@shepherdjerred/delivery/contract";
import { canonicalJson } from "homelab/scripts/canonical-json.ts";
import { withDeliveryTofuStack } from "homelab/scripts/tofu/delivery-stack.ts";
import { decryptDeliveryPlan } from "#lib/delivery/platform/plan-crypto.ts";
import { deliveryRequest } from "#lib/delivery/client.ts";
import type { DeliveryJobRequest } from "#shared/delivery-job.ts";
import { admitPlatformNativeJob } from "#lib/delivery/platform/native-job.ts";
import {
  stateMarkerStore,
  tofuOperation,
  tofuStackDirectory,
  writeTofuStateMarker,
  type MarkerStore,
} from "#lib/delivery/platform/tofu-input.ts";

/** Applying never replans: only authenticated bytes from the frozen successful plan are accepted. */
export async function run(
  request: DeliveryJobRequest,
  markerStore: () => MarkerStore = stateMarkerStore,
): Promise<unknown> {
  const input = tofuOperation(request.input);
  const { operation } = input;
  if (
    operation.kind !== "apply" ||
    operation.sourceRevision !== request.sourceRevision
  )
    throw new Error("Saved apply Job differs from its exact frozen source");
  const stored = await deliveryRequest(
    `platform/plans/${encodeURIComponent(operation.planDeploymentId)}`,
    RecordTofuPlanSchema,
  );
  if (canonicalJson(stored.receipt) !== canonicalJson(operation.plan))
    throw new Error(
      "Saved plan metadata differs from the exact approved snapshot",
    );
  const bytes = decryptDeliveryPlan(
    stored,
    z.string().min(32).parse(Bun.env["DELIVERY_PLAN_ENCRYPTION_PASSPHRASE"]),
  );
  const directory = tofuStackDirectory(input);
  return await withDeliveryTofuStack(
    operation.stack,
    async (context) => {
      if (
        canonicalJson(await context.state()) !==
        canonicalJson(operation.plan.state)
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
        state.lineage !== operation.plan.state.lineage ||
        state.serial < operation.plan.state.serial
      )
        throw new Error(
          "Applied plan did not preserve its recorded state lineage",
        );
      // T5: the state bucket carries the deployment that last applied it.
      const marker = await writeTofuStateMarker(markerStore(), {
        schema: "delivery-tofu-marker/v1",
        deploymentId: request.deploymentId,
        stack: operation.stack,
        stateLineage: state.lineage,
        stateSerial: state.serial,
        archiveDigest: input.archive?.digest ?? null,
        appliedAt: new Date().toISOString(),
      });
      return {
        stack: operation.stack,
        planDeploymentId: operation.planDeploymentId,
        planDigest: operation.plan.planDigest,
        state,
        marker,
        outcome: "applied-saved-plan",
      };
    },
    undefined,
    directory === undefined ? {} : { directory },
  );
}
