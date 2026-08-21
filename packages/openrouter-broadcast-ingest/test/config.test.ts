import { expect, test } from "vitest";
import { loadBroadcastConfig } from "#src/config.ts";

const completeEnv = {
  AWS_ACCESS_KEY_ID: "access",
  AWS_SECRET_ACCESS_KEY: "secret",
  LLM_OBSERVABILITY_ENABLED: "true",
  OPENROUTER_BROADCAST_BEARER_TOKEN: "broadcast-test-token-that-is-long-enough",
  S3_ENDPOINT: "http://seaweedfs.test:8333",
};

test("loads strict archive and service configuration", () => {
  const config = loadBroadcastConfig(completeEnv);
  expect(config.archive.bucket).toBe("llm-archive");
  expect(config.port).toBe(3000);
  expect(config.metricsPort).toBe(9090);
  expect(config.tempoOtlpHttpUrl).toBe(
    "http://tempo.tempo.svc.cluster.local:4318/v1/traces",
  );
});

test("fails fast when archive configuration or bearer auth is absent", () => {
  expect(() => loadBroadcastConfig({})).toThrow(
    "LLM archive must be explicitly enabled",
  );
  expect(() =>
    loadBroadcastConfig({
      ...completeEnv,
      OPENROUTER_BROADCAST_BEARER_TOKEN: undefined,
    }),
  ).toThrow("OPENROUTER_BROADCAST_BEARER_TOKEN is required");
});
