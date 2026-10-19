import { z } from "zod";
import {
  MinecraftProducerDiagnostic,
  MinecraftProducerError,
} from "./minecraft-controller-error.ts";
import { MinecraftControllerReceiptSchema as ControllerReceipt } from "@shepherdjerred/delivery/contract";
import type { DeploymentDetail } from "@shepherdjerred/delivery/contract";
import { MinecraftRecoveryReportEnvelopeSchema } from "@shepherdjerred/delivery/contract";
import {
  minecraftRuntimeImage,
  parseMinecraftEligibility,
} from "./minecraft.ts";

export const MINECRAFT_CONTROLLER_ORIGIN =
  "http://delivery-tsmc-controller.delivery-tsmc-controller.svc.cluster.local:7356";
export const MinecraftControllerReceiptSchema = ControllerReceipt.clone();
export type MinecraftControllerReceipt = z.infer<
  typeof MinecraftControllerReceiptSchema
>;

/** Operator outage transport is confined to an explicit local port-forward. */
export function minecraftRecoveryControllerOrigin(value: string): string {
  const controller = new URL(value);
  if (
    controller.protocol !== "http:" ||
    controller.hostname !== "127.0.0.1" ||
    controller.pathname !== "/" ||
    controller.search ||
    controller.hash ||
    controller.username ||
    controller.password ||
    !controller.port
  )
    throw new Error(
      "Controller transport must be an explicit loopback-only port-forward to delivery-tsmc-controller-0",
    );
  return controller.origin;
}

async function request(
  command:
    "eligibility" | "prepare" | "verify" | "prepare-recovery" | "recover",
  detail: DeploymentDetail,
  requestId: string,
  options: {
    signal?: AbortSignal | undefined;
    recoveryId?: string;
    controllerOrigin?: string | undefined;
  } = {},
): Promise<unknown> {
  minecraftRuntimeImage(detail);
  z.uuid().parse(requestId);
  const token = Bun.env["DELIVERY_EXECUTOR_TOKEN"];
  if (token === undefined || token.length === 0)
    throw new Error("Minecraft controller executor credential is missing");
  const timeout = AbortSignal.timeout(
    command === "verify" || command === "recover" ? 2 * 60 * 60_000 : 30_000,
  );
  const response = await fetch(
    new URL(
      `/requests/${requestId}/${command}`,
      options.controllerOrigin ?? MINECRAFT_CONTROLLER_ORIGIN,
    ),
    {
      method: "POST",
      // Preservation and recovery can legitimately be silent during a backup.
      // Their explicit AbortSignal deadline still bounds the whole request.
      ...(command === "verify" || command === "recover"
        ? { timeout: false as const }
        : {}),
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        deploymentId: detail.deployment.id,
        ...(options.recoveryId === undefined
          ? {}
          : { recoveryId: options.recoveryId }),
      }),
      signal:
        options.signal === undefined
          ? timeout
          : AbortSignal.any([timeout, options.signal]),
    },
  );
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const diagnostic = z
      .object({ diagnostic: MinecraftProducerDiagnostic })
      .safeParse(body);
    if (diagnostic.success)
      throw new MinecraftProducerError(diagnostic.data.diagnostic);
    throw new Error(
      `Dedicated Minecraft controller returned HTTP ${String(response.status)}; inspect its durable request journal`,
    );
  }
  return await response.json();
}
export async function runMinecraftEligibility(
  detail: DeploymentDetail,
  requestId: string,
) {
  return parseMinecraftEligibility(
    await request("eligibility", detail, requestId),
  );
}
export async function runMinecraftPreservation(
  detail: DeploymentDetail,
  requestId: string,
  onReceipt: (receipt: MinecraftControllerReceipt) => Promise<void>,
  signal?: AbortSignal,
): Promise<unknown> {
  const receipt = MinecraftControllerReceiptSchema.parse(
    await request("prepare", detail, requestId, { signal }),
  );
  await onReceipt(receipt);
  return await request("verify", detail, requestId, { signal });
}

export async function runMinecraftRecovery(
  detail: DeploymentDetail,
  recoveryId: string,
  requestId: string,
  options: {
    onReceipt: (receipt: MinecraftControllerReceipt) => Promise<void>;
    signal?: AbortSignal;
    controllerOrigin?: string | undefined;
  },
) {
  const receipt = MinecraftControllerReceiptSchema.parse(
    await request("prepare-recovery", detail, requestId, {
      signal: options.signal,
      recoveryId,
      controllerOrigin: options.controllerOrigin,
    }),
  );
  await options.onReceipt(receipt);
  return MinecraftRecoveryReportEnvelopeSchema.parse(
    await request("recover", detail, requestId, {
      signal: options.signal,
      recoveryId,
      controllerOrigin: options.controllerOrigin,
    }),
  );
}
