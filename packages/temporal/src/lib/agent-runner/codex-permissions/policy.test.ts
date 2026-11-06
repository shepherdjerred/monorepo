import { expect, it } from "vitest";
import { codexScopedPermissions } from "./policy.ts";
import type { RunCodexAgentTurnInput } from "#lib/agent-runner/contract.ts";

const input: Pick<
  RunCodexAgentTurnInput,
  "auth" | "sandboxPolicy" | "scopedPermissions"
> = {
  auth: { kind: "openai-api-key", apiKey: "fixture" },
  sandboxPolicy: {
    sandboxMode: "workspace-write",
    networkAccessEnabled: true,
    webSearchMode: "disabled",
  },
  scopedPermissions: {
    denyReadPaths: ["/private/MailMate.with spaces"],
    unixSockets: ["/private/task.sock"],
  },
};
it("keeps path keys intact and grants only the declared IPC socket", () => {
  const result = codexScopedPermissions(input);
  expect(result?.config).toEqual({ default_permissions: "agent-task" });
  const parsed = Bun.TOML.parse(result?.configOverrides.join("\n") ?? "");
  expect(parsed).toMatchObject({
    permissions: {
      "agent-task": {
        extends: ":workspace",
        filesystem: { "/private/MailMate.with spaces": "deny" },
        network: {
          enabled: true,
          unix_sockets: { "/private/task.sock": "allow" },
        },
      },
    },
  });
});
it("fails closed for unsupported modes or relative paths", () => {
  expect(() =>
    codexScopedPermissions({
      ...input,
      sandboxPolicy: {
        ...input.sandboxPolicy,
        sandboxMode: "danger-full-access",
      },
    }),
  ).toThrow("workspace-write");
  expect(() =>
    codexScopedPermissions({
      ...input,
      auth: { kind: "chatgpt-subscription", authJson: "fixture" },
    }),
  ).toThrow("API-key");
  expect(() =>
    codexScopedPermissions({
      ...input,
      scopedPermissions: { denyReadPaths: ["relative"], unixSockets: [] },
    }),
  ).toThrow();
  expect(
    codexScopedPermissions({
      auth: input.auth,
      sandboxPolicy: input.sandboxPolicy,
    }),
  ).toBeUndefined();
});
