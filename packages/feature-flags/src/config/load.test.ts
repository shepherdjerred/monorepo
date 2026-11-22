import { describe, expect, test } from "vitest";
import { loadFeatureFlagConfiguration } from "@shepherdjerred/feature-flags/config/load.ts";

describe("loadFeatureFlagConfiguration", () => {
  test("requires an explicit mode", () => {
    // No Zod default on purpose. A pod that forgets this should crash at
    // startup, not quietly serve call-site defaults while looking healthy.
    expect(() => loadFeatureFlagConfiguration({})).toThrow(
      /FEATURE_FLAGS_MODE is required \(flags \| flipt \| static \| disabled\)/,
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
});

describe("loadFeatureFlagConfiguration — flags mode", () => {
  test("flags mode requires FLAGS_URL and never falls back to FLIPT_URL", () => {
    expect(() =>
      loadFeatureFlagConfiguration({
        FEATURE_FLAGS_MODE: "flags",
        FLIPT_URL: "http://flipt.flipt.svc.cluster.local:8080",
        FLAGS_DEPLOYMENT: "scout/prod",
      }),
    ).toThrow(/FLAGS_URL is required when FEATURE_FLAGS_MODE=flags/);
    expect(() =>
      loadFeatureFlagConfiguration({
        FEATURE_FLAGS_MODE: "flags",
        FLAGS_URL: "",
        FLAGS_DEPLOYMENT: "scout/prod",
      }),
    ).toThrow(/FLAGS_URL is required when FEATURE_FLAGS_MODE=flags/);
  });

  test("flags mode requires FLAGS_DEPLOYMENT and never aliases FLIPT_NAMESPACE or FLIPT_ENVIRONMENT", () => {
    expect(() =>
      loadFeatureFlagConfiguration({
        FEATURE_FLAGS_MODE: "flags",
        FLAGS_URL: "http://flags.flags.svc.cluster.local:8080",
        FLIPT_NAMESPACE: "scout",
        FLIPT_ENVIRONMENT: "prod",
      }),
    ).toThrow(/FLAGS_DEPLOYMENT is required when FEATURE_FLAGS_MODE=flags/);
  });

  test.each([
    "not-a-url",
    "ftp://flags.flags.svc.cluster.local:8080",
    "ws://flags.flags.svc.cluster.local:8080",
    "file:///tmp/flags.json",
    "http://user:pass@flags.flags.svc.cluster.local:8080",
    "https://token@flags.flags.svc.cluster.local:8080",
    "http://:secret@flags.flags.svc.cluster.local:8080",
    "http://:@flags.flags.svc.cluster.local:8080",
  ])("flags mode rejects disallowed FLAGS_URL %s", (url) => {
    expect(() =>
      loadFeatureFlagConfiguration({
        FEATURE_FLAGS_MODE: "flags",
        FLAGS_URL: url,
        FLAGS_DEPLOYMENT: "scout/prod",
      }),
    ).toThrow();
  });

  test.each([
    "scout",
    "/prod",
    "scout/",
    "/",
    "scout/prod/extra",
    "scout /prod",
    "../prod",
    "scout/..",
    "./prod",
  ])("flags mode rejects malformed FLAGS_DEPLOYMENT %s", (deployment) => {
    expect(() =>
      loadFeatureFlagConfiguration({
        FEATURE_FLAGS_MODE: "flags",
        FLAGS_URL: "http://flags.flags.svc.cluster.local:8080",
        FLAGS_DEPLOYMENT: deployment,
      }),
    ).toThrow();
  });

  test("flags mode defaults poll interval to 300s and treats empty string as absent", () => {
    expect(
      loadFeatureFlagConfiguration({
        FEATURE_FLAGS_MODE: "flags",
        FLAGS_URL: "https://flags.example.test",
        FLAGS_DEPLOYMENT: "scout/beta",
        FLIPT_POLL_INTERVAL_SECONDS: "15",
      }),
    ).toEqual({
      mode: "flags",
      url: "https://flags.example.test",
      deployment: "scout/beta",
      pollIntervalSeconds: 300,
    });

    expect(
      loadFeatureFlagConfiguration({
        FEATURE_FLAGS_MODE: "flags",
        FLAGS_URL: "http://flags.flags.svc.cluster.local:8080",
        FLAGS_DEPLOYMENT: "minecraft/tsmc",
        FLAGS_POLL_INTERVAL_SECONDS: "",
      }),
    ).toEqual({
      mode: "flags",
      url: "http://flags.flags.svc.cluster.local:8080",
      deployment: "minecraft/tsmc",
      pollIntervalSeconds: 300,
    });
  });

  test("flags mode parses custom poll interval and rejects non-positive or non-integer values", () => {
    expect(
      loadFeatureFlagConfiguration({
        FEATURE_FLAGS_MODE: "flags",
        FLAGS_URL: "http://flags.flags.svc.cluster.local:8080",
        FLAGS_DEPLOYMENT: "scout/prod",
        FLAGS_POLL_INTERVAL_SECONDS: "60",
      }),
    ).toEqual({
      mode: "flags",
      url: "http://flags.flags.svc.cluster.local:8080",
      deployment: "scout/prod",
      pollIntervalSeconds: 60,
    });

    for (const invalid of ["0", "-5", "1.5", "abc"]) {
      expect(() =>
        loadFeatureFlagConfiguration({
          FEATURE_FLAGS_MODE: "flags",
          FLAGS_URL: "http://flags.flags.svc.cluster.local:8080",
          FLAGS_DEPLOYMENT: "scout/prod",
          FLAGS_POLL_INTERVAL_SECONDS: invalid,
        }),
      ).toThrow();
    }
  });
});

describe("loadFeatureFlagConfiguration — flipt and static modes", () => {
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
