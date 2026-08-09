import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "bun:test";
import {
  agentTaskSecretTokens,
  createAgentTaskSecretTokenState,
  refreshAgentTaskSecretTokenStateInBackground,
} from "./agent-task-env.ts";

describe("agent-task secret token state", () => {
  it("refreshes rotated mounted credentials in place", async () => {
    const tokenPath = path.join(
      os.tmpdir(),
      `agent-task-rotated-secret-${crypto.randomUUID()}`,
    );
    await Bun.write(tokenPath, "first-mounted-secret-value\n");

    try {
      const state = await createAgentTaskSecretTokenState("github-token", {}, [
        tokenPath,
      ]);
      await Bun.write(tokenPath, "second-mounted-secret-value\n");
      await state.refresh();

      expect(state.tokens).toContain("first-mounted-secret-value");
      expect(state.tokens).toContain("second-mounted-secret-value");
    } finally {
      await rm(tokenPath);
    }
  });

  it("tokenizes multiline environment credentials for redaction", () => {
    const pemBodyLine = "multiline-private-key-body-line";
    const tokens = agentTaskSecretTokens(undefined, {
      GITHUB_APP_PRIVATE_KEY: `-----BEGIN PRIVATE KEY-----\n${pemBodyLine}\n-----END PRIVATE KEY-----`,
    });

    expect(tokens).toContain(pemBodyLine);
  });

  it("forwards refresh failures so the activity can fail closed with the cause", async () => {
    const refreshError = new Error("mounted secret read failed");
    let observed: unknown;

    await refreshAgentTaskSecretTokenStateInBackground(
      { tokens: [], refresh: () => Promise.reject(refreshError) },
      (error) => {
        observed = error;
      },
    );

    expect(observed).toBe(refreshError);
  });
});
