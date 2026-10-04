import { SandboxListResponseSchema } from "@shepherdjerred/mc-harness/protocol/ipc.ts";
import { daemonRequest } from "#lib/mc/client.ts";

/**
 * Resolves `--target`: an explicit sandbox id, or the single running sandbox.
 * Never defaults to a live server.
 */
export async function resolveTarget(
  explicit: string | undefined,
): Promise<string> {
  if (explicit === "live") {
    throw new Error(
      "The live tsmc target is not available yet; use a sandbox (toolkit mc sandbox up).",
    );
  }
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
      "No sandbox is running. Start one with: toolkit mc sandbox up",
    );
  }
  if (ready.length > 1) {
    throw new Error(
      `Several sandboxes are running (${ready.map((sandbox) => sandbox.id).join(", ")}); pass --target <id>.`,
    );
  }
  return only.id;
}
