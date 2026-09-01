import { describe, expect, test } from "vitest";
import { loadFeatureFlagConfiguration } from "@shepherdjerred/feature-flags/config/load.ts";

describe("loadFeatureFlagConfiguration", () => {
  test("requires an explicit mode", () => {
    // No Zod default on purpose. A pod that forgets this should crash at
    // startup, not quietly serve call-site defaults while looking healthy.
    expect(() => loadFeatureFlagConfiguration({})).toThrow(
      /FEATURE_FLAGS_MODE is required/,
    );
  });

  test("rejects an unknown mode rather than falling back", () => {
    expect(() =>
      loadFeatureFlagConfiguration({ FEATURE_FLAGS_MODE: "maybe" }),
    ).toThrow();
  });

  test("does not sniff NODE_ENV", () => {
    // A hidden environment fork is the silent fallback this repo bans: a test
    // run that quietly disabled flags would hide a broken configuration.
    expect(() => loadFeatureFlagConfiguration({ NODE_ENV: "test" })).toThrow(
      /FEATURE_FLAGS_MODE is required/,
    );
  });

  test("disabled mode needs nothing else", () => {
    expect(
      loadFeatureFlagConfiguration({ FEATURE_FLAGS_MODE: "disabled" }),
    ).toEqual({ mode: "disabled" });
  });

  test("flipt mode requires a URL", () => {
    expect(() =>
      loadFeatureFlagConfiguration({ FEATURE_FLAGS_MODE: "flipt" }),
    ).toThrow(/FLIPT_URL is required/);
  });

  test("flipt mode requires an explicit environment", () => {
    expect(() =>
      loadFeatureFlagConfiguration({
        FEATURE_FLAGS_MODE: "flipt",
        FLIPT_URL: "http://flipt.flipt.svc.cluster.local:8080",
        FLIPT_NAMESPACE: "scout",
      }),
    ).toThrow(/FLIPT_ENVIRONMENT is required/);
  });

  test("flipt mode requires an explicit namespace", () => {
    expect(() =>
      loadFeatureFlagConfiguration({
        FEATURE_FLAGS_MODE: "flipt",
        FLIPT_URL: "http://flipt.flipt.svc.cluster.local:8080",
        FLIPT_ENVIRONMENT: "beta",
      }),
    ).toThrow(/FLIPT_NAMESPACE is required/);
  });

  test("flipt mode rejects a malformed URL as a config error", () => {
    expect(() =>
      loadFeatureFlagConfiguration({
        FEATURE_FLAGS_MODE: "flipt",
        FLIPT_URL: "not-a-url",
        FLIPT_NAMESPACE: "scout",
        FLIPT_ENVIRONMENT: "beta",
      }),
    ).toThrow();
  });

  test("flipt mode defaults the poll interval to 300s", () => {
    // 30s would be fine here since self-hosted Flipt is unmetered, but 300s
    // keeps parity with what a metered backend could afford and is still far
    // below the deploy latency this replaces.
    expect(
      loadFeatureFlagConfiguration({
        FEATURE_FLAGS_MODE: "flipt",
        FLIPT_URL: "http://flipt.flipt.svc.cluster.local:8080",
        FLIPT_NAMESPACE: "scout",
        FLIPT_ENVIRONMENT: "beta",
      }),
    ).toEqual({
      mode: "flipt",
      url: "http://flipt.flipt.svc.cluster.local:8080",
      namespace: "scout",
      environment: "beta",
      pollIntervalSeconds: 300,
    });
  });

  test("flipt mode rejects a non-positive poll interval", () => {
    expect(() =>
      loadFeatureFlagConfiguration({
        FEATURE_FLAGS_MODE: "flipt",
        FLIPT_URL: "http://flipt.flipt.svc.cluster.local:8080",
        FLIPT_NAMESPACE: "scout",
        FLIPT_ENVIRONMENT: "beta",
        FLIPT_POLL_INTERVAL_SECONDS: "0",
      }),
    ).toThrow();
  });

  test("static mode parses overrides and tolerates an empty map", () => {
    expect(
      loadFeatureFlagConfiguration({
        FEATURE_FLAGS_MODE: "static",
        FEATURE_FLAGS_STATIC_OVERRIDES: '{"a":true,"b":"x","c":1}',
      }),
    ).toEqual({ mode: "static", overrides: { a: true, b: "x", c: 1 } });
    expect(
      loadFeatureFlagConfiguration({ FEATURE_FLAGS_MODE: "static" }),
    ).toEqual({ mode: "static", overrides: {} });
  });

  test("static mode rejects non-scalar override values", () => {
    // An object override would reach Flipt's string-only context and match on
    // "[object Object]".
    expect(() =>
      loadFeatureFlagConfiguration({
        FEATURE_FLAGS_MODE: "static",
        FEATURE_FLAGS_STATIC_OVERRIDES: '{"a":{"nested":true}}',
      }),
    ).toThrow();
  });
});
