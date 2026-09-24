import { describe, expect, test } from "vitest";
import { providerCredentialsFromEnv } from "@shepherdjerred/llm-runtime";

const FEDERATION = {
  ANTHROPIC_IDENTITY_TOKEN_FILE: "/var/run/secrets/anthropic.com/token",
  ANTHROPIC_FEDERATION_RULE_ID: "fdrl_x",
  ANTHROPIC_ORGANIZATION_ID: "org",
  ANTHROPIC_SERVICE_ACCOUNT_ID: "svac_x",
};

describe("provider credentials from the environment", () => {
  test("a provider with no configuration is simply absent", () => {
    expect(providerCredentialsFromEnv({})).toEqual({});
  });

  test("reads each provider independently", () => {
    const credentials = providerCredentialsFromEnv({
      OPENAI_API_KEY: "sk-openai",
      ANTHROPIC_API_KEY: "sk-ant",
      GOOGLE_VERTEX_PROJECT: "proj",
      GOOGLE_VERTEX_LOCATION: "us-central1",
    });
    expect(credentials.openai).toEqual({ apiKey: "sk-openai" });
    expect(credentials.anthropic).toEqual({ kind: "apiKey", apiKey: "sk-ant" });
    expect(credentials.google).toEqual({
      project: "proj",
      location: "us-central1",
    });
  });

  test("federation wins over a leftover static key", () => {
    // The Anthropic SDKs rank the key highest and let it shadow federation.
    // Here the deliberate ordering is the other way round.
    const credentials = providerCredentialsFromEnv({
      ...FEDERATION,
      ANTHROPIC_API_KEY: "sk-ant-leftover",
    });
    expect(credentials.anthropic).toMatchObject({ kind: "federation" });
  });

  test("a partially configured federation fails instead of falling back", () => {
    expect(() =>
      providerCredentialsFromEnv({
        ANTHROPIC_FEDERATION_RULE_ID: "fdrl_x",
        ANTHROPIC_API_KEY: "sk-ant",
      }),
    ).toThrow("partially configured");
  });

  test("blank values count as absent, not as empty credentials", () => {
    expect(providerCredentialsFromEnv({ OPENAI_API_KEY: "   " })).toEqual({});
  });

  test("falls back to the ambient Google project", () => {
    expect(
      providerCredentialsFromEnv({ GOOGLE_CLOUD_PROJECT: "ambient" }).google,
    ).toEqual({ project: "ambient" });
  });
});
