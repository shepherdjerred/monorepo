import { Context } from "@temporalio/activity";
import { argoApplicationRequest } from "#lib/delivery/argo-client.ts";
import { verifyArgoRelease as verifyOwnedArgoRelease } from "#lib/delivery/argocd-proof.ts";
import {
  deliverySelectionPatch,
  assertDeliveryRootPreservesSelection,
  type DeliverySelection,
} from "homelab/scripts/argocd/argocd-delivery.ts";

export async function argoRequest(
  path: string,
  body?: unknown,
): Promise<unknown> {
  return await argoApplicationRequest(
    path,
    body,
    Context.current().cancellationSignal,
  );
}

export async function selectArgoRelease(selection: DeliverySelection) {
  assertDeliveryRootPreservesSelection(await argoRequest("apps"));
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
  const context = Context.current();
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
  const process = Bun.spawn(
    [
      "bun",
      command,
      "sync-managed",
      selection.application,
      "--revision",
      selection.revision,
      "--request-id",
      operationId,
      "--timeout",
      "1200",
    ],
    {
      cwd: new URL("../../../../../", import.meta.url).pathname,
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
      env: {
        PATH: Bun.env["PATH"],
        ARGOCD_SERVER_URL: Bun.env["ARGOCD_SERVER_URL"],
        ARGOCD_TOKEN: Bun.env["ARGOCD_TOKEN"],
      },
    },
  );
  const cancel = () => {
    process.kill("SIGKILL");
  };
  context.cancellationSignal.addEventListener("abort", cancel, { once: true });
  const heartbeat = setInterval(() => {
    context.heartbeat({ operationId, application: selection.application });
  }, 10_000);
  try {
    if (context.cancellationSignal.aborted) cancel();
    if ((await process.exited) !== 0)
      throw new Error(
        "Guarded Argo synchronization failed; inspect the recorded request before retrying",
      );
  } finally {
    clearInterval(heartbeat);
    context.cancellationSignal.removeEventListener("abort", cancel);
  }
}

export function verifyArgoRelease(
  input: unknown,
  selection: DeliverySelection,
  operationId: string,
) {
  return verifyOwnedArgoRelease(input, selection, operationId);
}
