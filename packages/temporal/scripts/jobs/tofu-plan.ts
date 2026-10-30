import { createHash } from "node:crypto";
import path from "node:path";
import { z } from "zod";
import { TofuPlanReceiptSchema } from "@shepherdjerred/delivery/contract";
import { canonicalJson } from "homelab/scripts/canonical-json.ts";
import {
  withDeliveryTofuStack,
  deliveryTofuChanges,
  privateProviderJson,
} from "homelab/scripts/tofu/delivery-stack.ts";
import { encryptDeliveryPlan } from "#lib/delivery/platform/plan-crypto.ts";
import {
  tofuOperation,
  tofuStackOptions,
} from "#lib/delivery/platform/tofu-input.ts";
import type { DeliveryJobRequest } from "#shared/delivery-job.ts";

/**
 * The plan receipt binds the archive through `nativeJob.specFingerprint`: the
 * Job manifest hashes the whole request, including `archive.digest`, so a
 * receipt produced from other bytes names a different native Job.
 */
export async function run(request: DeliveryJobRequest): Promise<unknown> {
  const input = tofuOperation(request.input);
  const { operation } = input;
  if (
    operation.kind !== "plan" ||
    operation.sourceRevision !== request.sourceRevision
  )
    throw new Error("Saved plan Job differs from its qualified frozen source");
  return await withDeliveryTofuStack(
    operation.stack,
    async (context) => {
      const before = await context.state();
      const planPath = path.join(context.workspace, "plan.tfplan");
      await context.command(
        [
          "plan",
          "-input=false",
          "-lock-timeout=5m",
          "-detailed-exitcode",
          `-out=${planPath}`,
        ],
        [0, 2],
      );
      const file = Bun.file(planPath);
      if (file.size === 0 || file.size > 8 * 1024 * 1024)
        throw new Error("Saved plan exceeds its private byte bound");
      const bytes = new Uint8Array(await file.arrayBuffer());
      const rendered = await context.command(["show", "-json", planPath]);
      const changes = deliveryTofuChanges(privateProviderJson(rendered.stdout));
      if (canonicalJson(await context.state()) !== canonicalJson(before))
        throw new Error(
          "Remote state changed while preparing the exact saved plan",
        );
      const createdAt = new Date();
      const receipt = TofuPlanReceiptSchema.parse({
        schema: "delivery-tofu-plan/v1",
        deploymentId: request.deploymentId,
        sourceBuildId: operation.sourceBuildId,
        sourceRevision: operation.sourceRevision,
        stack: operation.stack,
        createdAt: createdAt.toISOString(),
        expiresAt: new Date(
          createdAt.getTime() + 24 * 60 * 60 * 1000,
        ).toISOString(),
        planDigest: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
        state: before,
        changes,
        nativeJob: {
          namespace: Bun.env["DELIVERY_JOB_NAMESPACE"],
          name: Bun.env["DELIVERY_JOB_NAME"],
          uid: Bun.env["DELIVERY_JOB_UID"],
          specFingerprint: Bun.env["DELIVERY_JOB_FINGERPRINT"],
          requestId: request.deploymentId,
        },
      });
      return encryptDeliveryPlan(
        receipt,
        bytes,
        z
          .string()
          .min(32)
          .parse(Bun.env["DELIVERY_PLAN_ENCRYPTION_PASSPHRASE"]),
      );
    },
    undefined,
    tofuStackOptions(input),
  );
}
