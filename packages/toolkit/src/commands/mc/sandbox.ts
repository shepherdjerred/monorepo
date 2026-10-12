import {
  SandboxDownResponseSchema,
  SandboxListResponseSchema,
  SandboxSummarySchema,
  type SandboxCreateRequest,
} from "@shepherdjerred/mc-harness/protocol/ipc.ts";
import { daemonRequest } from "#lib/mc/client.ts";
import { renderSandbox, renderSandboxes } from "#lib/mc/render.ts";

export async function mcSandboxUpCommand(
  request: SandboxCreateRequest,
  json: boolean,
): Promise<void> {
  if (!json) {
    console.error(
      `Booting a ${request.profile}/${request.world} sandbox (first boot downloads Paper; ~1–3 min)…`,
    );
  }
  const sandbox = await daemonRequest(
    SandboxSummarySchema,
    "POST",
    "/sandboxes",
    request,
  );
  console.log(json ? JSON.stringify(sandbox, null, 2) : renderSandbox(sandbox));
}

export async function mcSandboxListCommand(json: boolean): Promise<void> {
  const { sandboxes } = await daemonRequest(
    SandboxListResponseSchema,
    "GET",
    "/sandboxes",
  );
  console.log(
    json ? JSON.stringify(sandboxes, null, 2) : renderSandboxes(sandboxes),
  );
}

async function allSandboxIds(): Promise<string[]> {
  const { sandboxes } = await daemonRequest(
    SandboxListResponseSchema,
    "GET",
    "/sandboxes",
  );
  return sandboxes.map((sandbox) => sandbox.id);
}

export async function mcSandboxDownCommand(
  ids: readonly string[],
  all: boolean,
): Promise<void> {
  const targets = all ? await allSandboxIds() : ids;
  if (targets.length === 0) {
    console.log("No sandboxes to remove.");
    return;
  }
  for (const id of targets) {
    const { removed } = await daemonRequest(
      SandboxDownResponseSchema,
      "DELETE",
      `/sandboxes/${encodeURIComponent(id)}`,
    );
    console.log(`removed ${removed.join(", ")}`);
  }
}
