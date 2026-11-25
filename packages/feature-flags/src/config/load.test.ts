import { describe, expect, test } from "vitest";
import { loadFeatureFlagConfiguration } from "@shepherdjerred/feature-flags/config/load.ts";

describe("loadFeatureFlagConfiguration", () => {
  test("requires an explicit mode", () => {
    // No Zod default on purpose. A pod that forgets this should crash at
    // startup, not quietly serve call-site defaults while looking healthy.
    expect(() => loadFeatureFlagConfiguration({})).toThrow(
      /FEATURE_FLAGS_MODE is required \(flags \| static \| disabled\)/,
    );
  });

  test("rejects an unknown mode rather than falling back", () => {
    expect(() =>
      loadFeatureFlagConfiguration({ FEATURE_FLAGS_MODE: "maybe" }),
    ).toThrow();
    expect(() =>
      loadFeatureFlagConfiguration({ FEATURE_FLAGS_MODE: "remote" }),
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
  test("flags mode requires FLAGS_URL and rejects missing or blank values", () => {
    expect(() =>
      loadFeatureFlagConfiguration({
        FEATURE_FLAGS_MODE: "flags",
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

  test("flags mode requires FLAGS_DEPLOYMENT and rejects missing or blank values", () => {
    expect(() =>
      loadFeatureFlagConfiguration({
        FEATURE_FLAGS_MODE: "flags",
        FLAGS_URL: "http://flags.flags.svc.cluster.local:8080",
      }),
    ).toThrow(/FLAGS_DEPLOYMENT is required when FEATURE_FLAGS_MODE=flags/);
    expect(() =>
      loadFeatureFlagConfiguration({
        FEATURE_FLAGS_MODE: "flags",
        FLAGS_URL: "http://flags.flags.svc.cluster.local:8080",
        FLAGS_DEPLOYMENT: "",
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

describe("loadFeatureFlagConfiguration — static mode", () => {
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
    // An object override would reach string-only evaluation context and match on
    // "[object Object]".
    expect(() =>
      loadFeatureFlagConfiguration({
        FEATURE_FLAGS_MODE: "static",
        FEATURE_FLAGS_STATIC_OVERRIDES: '{"a":{"nested":true}}',
      }),
    ).toThrow();
  });
});
