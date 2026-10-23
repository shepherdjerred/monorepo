import { Context } from "@temporalio/activity";
import { z } from "zod";
import { argoApplicationRequest } from "#lib/delivery/argo-client.ts";
import { effectSignal } from "#lib/delivery/model/effect-signal.ts";
import { verifyArgoRelease as verifyOwnedArgoRelease } from "#lib/delivery/argocd-proof.ts";
import { observePendingArgoRelease } from "#lib/delivery/argocd-proof.ts";
import { forumSyncPrunes } from "#lib/delivery/forum-prune.ts";
import { arcadeSyncPrunes } from "#lib/delivery/arcade/prune.ts";
import {
  deliverySelectionPatch,
  type DeliverySelection,
} from "homelab/scripts/argocd/argocd-delivery.ts";

export async function argoRequest(
  path: string,
  body?: unknown,
): Promise<unknown> {
  return await argoApplicationRequest(path, body, effectSignal());
}

/** The retired root Application is never consulted; Delivery owns each Application body. */
export async function selectArgoRelease(selection: DeliverySelection) {
  const path = encodeURIComponent(selection.application);
  const current = await argoRequest(path);
  const patch = deliverySelectionPatch(current, selection);
  await argoRequest(path, { patch: JSON.stringify(patch), patchType: "json" });
}

/** Existing CLI retains immutable-field and exact operation ownership checks. */
export async function syncArgoRelease(
  selection: DeliverySelection,
  operationId: string,
) {
  const prune =
    (await forumSyncPrunes(selection, argoRequest)) ||
    (await arcadeSyncPrunes(selection, argoRequest));
  await runGuardedArgoCommand(
    [
      "sync-managed",
      selection.application,
      "--revision",
      selection.revision,
      "--request-id",
      operationId,
      ...(prune ? ["--prune"] : []),
      "--timeout",
      "1200",
    ],
    { operationId, application: selection.application },
  );
}

/**
 * Runs one subcommand of the guarded Argo CLI bundled into the worker image,
 * heartbeating with `details` and killing it on cancellation or when a model
 * step loses its lease.
 */
export async function runGuardedArgoCommand(
  args: string[],
  details: { operationId: string; application: string },
) {
  const context = Context.current();
  const signal = effectSignal();
  const bundled = new URL("../../../dist/delivery-argocd.js", import.meta.url)
    .pathname;
  const command =
    Bun.env["ENVIRONMENT"] === "production"
      ? bundled
      : new URL("../../../../homelab/scripts/argocd/argocd.ts", import.meta.url)
          .pathname;
  if (!(await Bun.file(command).exists()))
    throw new Error(
      "Required guarded Argo command is missing from the worker image",
    );
  const process = Bun.spawn(["bun", command, ...args], {
    cwd: new URL("../../../../../", import.meta.url).pathname,
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
    env: {
      PATH: Bun.env["PATH"],
      ARGOCD_SERVER_URL: Bun.env["ARGOCD_SERVER_URL"],
      ARGOCD_TOKEN: Bun.env["ARGOCD_TOKEN"],
    },
  });
  const cancel = () => {
    process.kill("SIGKILL");
  };
  signal.addEventListener("abort", cancel, { once: true });
  const heartbeat = setInterval(() => {
    context.heartbeat(details);
  }, 10_000);
  try {
    if (signal.aborted) cancel();
    if ((await process.exited) !== 0)
      throw new Error(
        `Guarded Argo ${args[0] ?? "command"} failed; inspect the recorded request before retrying`,
      );
  } finally {
    clearInterval(heartbeat);
    signal.removeEventListener("abort", cancel);
  }
}

export function verifyArgoRelease(
  input: unknown,
  selection: DeliverySelection,
  operationId: string,
) {
  return verifyOwnedArgoRelease(input, selection, operationId);
}

/** Wait for owned status propagation without repeating native effects. */
export async function waitForArgoRelease(
  selection: DeliverySelection,
  requestId: string,
  effects: {
    read: () => Promise<unknown>;
    fence: () => Promise<void>;
    wait: (milliseconds: number) => Promise<unknown>;
  },
) {
  let identity: string | undefined;
  let operation: string | undefined;
  for (let attempt = 0; attempt < 60; attempt++) {
    await effects.fence();
    const application = await effects.read();
    const uid = z
      .object({ metadata: z.object({ uid: z.string().min(1) }) })
      .parse(application).metadata.uid;
    if (identity !== undefined && identity !== uid)
      throw new Error("Application incarnation changed while waiting");
    identity = uid;
    deliverySelectionPatch(application, selection);
    const observed = observePendingArgoRelease(
      application,
      selection,
      requestId,
    );
    if (operation !== undefined && operation !== observed.operationId)
      throw new Error("Owned operation changed while waiting");
    operation = observed.operationId;
    if (observed.sync === "Synced" && observed.health === "Healthy")
      return verifyArgoRelease(application, selection, requestId);
    if (attempt < 59) await effects.wait(5000);
  }
  throw new Error(
    "Timed out waiting for genuine Synced Healthy release observation",
  );
}
