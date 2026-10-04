import { SandboxListResponseSchema } from "@shepherdjerred/mc-harness/protocol/ipc.ts";
import { LIVE_TARGET_ID } from "@shepherdjerred/mc-harness/protocol/live.ts";
import { daemonRequest } from "#lib/mc/client.ts";

/**
 * Resolves `--target`: an explicit sandbox id or `live`, or the single running
 * sandbox. Never defaults to the live server.
 */
export async function resolveTarget(
  explicit: string | undefined,
): Promise<string> {
  if (explicit !== undefined) {
    return explicit;
  }
  const { sandboxes } = await daemonRequest(
    SandboxListResponseSchema,
    "GET",
    "/sandboxes",
  );
  const ready = sandboxes.filter((sandbox) => sandbox.status === "ready");
  const [only] = ready;
  if (only === undefined) {
    throw new Error(
      `No sandbox is running. Start one with: toolkit mc sandbox up (live tsmc is never implied; pass --target ${LIVE_TARGET_ID})`,
    );
  }
  if (ready.length > 1) {
    throw new Error(
      `Several sandboxes are running (${ready.map((sandbox) => sandbox.id).join(", ")}); pass --target <id>.`,
    );
  }
  return only.id;
}
