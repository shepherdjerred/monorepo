import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  agentTaskProviderSecretTokens,
  agentTaskSecretTokens,
  createAgentTaskSecretTokenState,
  refreshAgentTaskSecretTokenStateInBackground,
} from "./agent-task-env.ts";

describe("agent-task secret token state", () => {
  it("scans provider token values without treating metadata or ordinary env as secrets", () => {
    const auth = JSON.stringify({
      auth_mode: "chatgpt",
      tokens: {
        access_token: "provider-access-value",
        refresh_token: "provider-refresh-value",
        id_token: "provider-id-value",
      },
    });
    const encoded = Buffer.from(auth).toString("base64");
    const tokens = agentTaskProviderSecretTokens({
      CODEX_AUTH_JSON_B64: encoded,
      CLAUDE_CODE_OAUTH_TOKEN: "claude-oauth-value",
      NODE_ENV: "prod",
      AGENT_PROVIDER_UID: "0",
    });
    expect(tokens).toEqual([
      encoded,
      auth,
      "provider-access-value",
      "provider-refresh-value",
      "provider-id-value",
      "claude-oauth-value",
    ]);
  });

  it("rejects malformed structured provider credentials", () => {
    expect(() =>
      agentTaskProviderSecretTokens({
        CODEX_AUTH_JSON_B64: Buffer.from('{"tokens":{}}').toString("base64"),
      }),
    ).toThrow();
  });

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
      expect(state.mountedTokens).toContain("first-mounted-secret-value");
      expect(state.mountedTokens).toContain("second-mounted-secret-value");
    } finally {
      await rm(tokenPath);
    }
  });

  it("tokenizes multiline environment credentials for redaction", () => {
    const pemBodyLine = "multiline-private-key-body-line";
    const tokens = agentTaskSecretTokens(undefined, {
      GITHUB_APP_PRIVATE_KEY: `credential-header\n${pemBodyLine}\ncredential-footer`,
    });

    expect(tokens).toContain(pemBodyLine);
  });

  it("tokenizes escaped multiline environment credentials for redaction", () => {
    const pemBodyLine = "escaped-multiline-private-key-body";
    const tokens = agentTaskSecretTokens(undefined, {
      GITHUB_APP_PRIVATE_KEY: String.raw`credential-header\n${pemBodyLine}\ncredential-footer`,
    });

    expect(tokens).toContain(pemBodyLine);
  });

  it("tokenizes credential values embedded in structured environment text", () => {
    const credentialFragment = "structured-secret-fragment";
    const tokens = agentTaskSecretTokens(undefined, {
      AGENT_CONFIG: JSON.stringify({ privateKey: credentialFragment }),
    });

    expect(tokens).toContain(credentialFragment);
  });

  it("tokenizes the decoded Codex auth document for redaction", () => {
    const decodedCredential = "decoded-codex-credential-value";
    const tokens = agentTaskSecretTokens(undefined, {
      CODEX_AUTH_JSON_B64: Buffer.from(
        JSON.stringify({ tokens: { access_token: decodedCredential } }),
      ).toString("base64"),
    });

    expect(tokens).toContain(decodedCredential);
  });

  it("forwards refresh failures so the activity can fail closed with the cause", async () => {
    const refreshError = new Error("mounted secret read failed");
    let observed: unknown;

    await refreshAgentTaskSecretTokenStateInBackground(
      {
        tokens: [],
        mountedTokens: [],
        refresh: () => Promise.reject(refreshError),
      },
      (error) => {
        observed = error;
      },
    );

    expect(observed).toBe(refreshError);
  });
});
