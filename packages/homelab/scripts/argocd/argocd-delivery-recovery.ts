import { createHash } from "node:crypto";
import { z } from "zod";
import { DELIVERY_DELEGATION_DEFINITIONS } from "#delivery-ownership";
import {
  DeliverySelectionSchema,
  assertDeliveryRootPreservesSelection,
  deliverySelectionPatch,
} from "./argocd-delivery.ts";

export const DeliveryRecoverySelectionSchema = z
  .object({
    deploymentId: z.string().min(1),
    requestId: z.uuid(),
    selection: DeliverySelectionSchema,
    chart: z
      .object({
        uri: z.url(),
        digest: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
      })
      .strict(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      DELIVERY_DELEGATION_DEFINITIONS[value.selection.application] !==
      value.selection.environmentId
    )
      context.addIssue({
        code: "custom",
        message: "Recovery selection is not a reviewed Delivery delegation",
      });
    const expectedUri = `${value.selection.repository.replace(/\/$/u, "")}/charts/${value.selection.chart}-${value.selection.revision}.tgz`;
    if (value.chart.uri !== expectedUri)
      context.addIssue({
        code: "custom",
        message: "Recovery chart URI differs from its exact source selection",
      });
    if (
      Object.entries(value.selection.parameters).some(
        ([key, parameter]) =>
          /password|secret|token|credential|private.?key|api.?key|auth.?key/iu.test(
            key,
          ) || parameter.startsWith("op://"),
      )
    )
      context.addIssue({
        code: "custom",
        message:
          "Recovery exports cannot contain credential parameter keys or vault references",
      });
  });

/** Explicit recovery only: normal sync-managed calls never change source selection. */
export async function selectDeliveryRecoverySource(
  raw: unknown,
  options: {
    application: string;
    revision: string;
    requestId: string;
    origin: string;
    token?: string;
    dryRun: boolean;
  },
): Promise<void> {
  const input = DeliveryRecoverySelectionSchema.parse(raw);
  if (
    input.selection.application !== options.application ||
    input.selection.revision !== options.revision ||
    input.requestId !== options.requestId
  )
    throw new Error(
      "Recovery command identity differs from the frozen Delivery export",
    );
  if (options.dryRun) return;
  if (options.token === undefined)
    throw new Error("Argo recovery mutation credential is missing");
  const headers = {
    Authorization: `Bearer ${options.token}`,
    "Content-Type": "application/json",
  };
  async function application(name: string) {
    const response = await fetch(
      new URL(
        `/api/v1/applications/${encodeURIComponent(name)}`,
        options.origin,
      ),
      { headers, signal: AbortSignal.timeout(30_000), redirect: "error" },
    );
    if (!response.ok)
      throw new Error(
        `Recovery inspection returned HTTP ${String(response.status)}`,
      );
    const result: unknown = await response.json();
    return result;
  }
  assertDeliveryRootPreservesSelection(await application("apps"));
  const current = await application(options.application);
  const patch = deliverySelectionPatch(current, input.selection);
  const chart = await fetch(input.chart.uri, {
    signal: AbortSignal.timeout(30_000),
    redirect: "error",
  });
  if (!chart.ok)
    throw new Error(
      `Recovery chart inspection returned HTTP ${String(chart.status)}`,
    );
  const digest = `sha256:${createHash("sha256")
    .update(new Uint8Array(await chart.arrayBuffer()))
    .digest("hex")}`;
  if (digest !== input.chart.digest)
    throw new Error("Recovery chart bytes differ from the frozen digest");
  const response = await fetch(
    new URL(
      `/api/v1/applications/${encodeURIComponent(options.application)}`,
      options.origin,
    ),
    {
      method: "PATCH",
      headers,
      signal: AbortSignal.timeout(30_000),
      redirect: "error",
      body: JSON.stringify({ patch: JSON.stringify(patch), patchType: "json" }),
    },
  );
  if (!response.ok)
    throw new Error(
      `Recovery source selection returned HTTP ${String(response.status)}; inspect before repeating`,
    );
}
