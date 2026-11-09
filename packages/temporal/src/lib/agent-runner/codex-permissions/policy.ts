import { z } from "zod/v4";
import type { RunCodexAgentTurnInput } from "#lib/agent-runner/contract.ts";

const Absolute = z.string().startsWith("/").min(2);
const Scope = z.strictObject({
  denyReadPaths: z.array(Absolute).min(1),
  unixSockets: z.array(Absolute),
});
function table(paths: string[], access: string) {
  return `{${paths.map((p) => `${JSON.stringify(p)}=${JSON.stringify(access)}`).join(",")}}`;
}

export function codexScopedPermissions(
  input: Pick<
    RunCodexAgentTurnInput,
    "auth" | "sandboxPolicy" | "scopedPermissions"
  >,
) {
  if (input.scopedPermissions === undefined) return;
  if (
    input.auth.kind !== "openai-api-key" ||
    input.sandboxPolicy.sandboxMode !== "workspace-write"
  )
    throw new Error(
      "Scoped permissions require API-key authentication and workspace-write mode",
    );
  const scope = Scope.parse(input.scopedPermissions);
  return {
    config: { default_permissions: "agent-task" },
    configOverrides: [
      'permissions.agent-task.extends=":workspace"',
      `permissions.agent-task.filesystem=${table(scope.denyReadPaths, "deny")}`,
      `permissions.agent-task.network.enabled=${String(input.sandboxPolicy.networkAccessEnabled)}`,
      `permissions.agent-task.network.unix_sockets=${table(scope.unixSockets, "allow")}`,
    ],
  };
}
