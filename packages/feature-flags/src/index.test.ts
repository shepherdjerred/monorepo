import { afterEach, describe, expect, test } from "vitest";
import {
  initFeatureFlags,
  isEnabled,
  numberValue,
  shutdownFeatureFlags,
  stringValue,
} from "@shepherdjerred/feature-flags/index.ts";
import { isAbsent } from "@shepherdjerred/feature-flags/flag-result.ts";
import { StaticProvider } from "@shepherdjerred/feature-flags/providers/static.ts";

const DISABLED = { FEATURE_FLAGS_MODE: "disabled" } as const;

afterEach(async () => {
  await shutdownFeatureFlags();
});

describe("disabled mode", () => {
  test("reports every flag absent so callers fall through to lower layers", async () => {
    await initFeatureFlags({ environment: DISABLED });
    const result = await isEnabled("anything", {
      default: false,
      targetingKey: "service",
    });
    expect(result.value).toBe(false);
    expect(result.errorCode).toBe("FLAG_NOT_FOUND");
    expect(isAbsent(result)).toBe(true);
  });

  test("returns the call-site default rather than a fixed false", async () => {
    await initFeatureFlags({ environment: DISABLED });
    // The default IS the answer when nothing is configured, so a `true` default
    // must survive. Returning `false` here would silently disable features the
    // moment flags were introduced.
    const result = await isEnabled("anything", {
      default: true,
      targetingKey: "service",
    });
    expect(result.value).toBe(true);
  });
});

describe("static mode", () => {
  test("a defined flag RESOLVES and is not absent", async () => {
    await initFeatureFlags({
      environment: DISABLED,
      provider: new StaticProvider({ "known-flag": true }),
    });
    const result = await isEnabled("known-flag", {
      default: false,
      targetingKey: "service",
    });
    expect(result.value).toBe(true);
    expect(isAbsent(result)).toBe(false);
  });

  test("a flag defined as FALSE resolves — it must not fall through", async () => {
    // This is the single most important assertion in the package. A flag
    // deliberately turned off must stop the waterfall. If it reported absence,
    // `@shepherdjerred/config` would descend to an env var still set to `true`
    // and silently re-enable the thing an operator just disabled.
    await initFeatureFlags({
      environment: DISABLED,
      provider: new StaticProvider({ "kill-switch": false }),
    });
    const result = await isEnabled("kill-switch", {
      default: true,
      targetingKey: "service",
    });
    expect(result.value).toBe(false);
    expect(result.reason).toBe("STATIC");
    expect(isAbsent(result)).toBe(false);
  });

  test("an undefined flag is absent even when others are defined", async () => {
    await initFeatureFlags({
      environment: DISABLED,
      provider: new StaticProvider({ "known-flag": true }),
    });
    const result = await isEnabled("missing-flag", {
      default: false,
      targetingKey: "service",
    });
    expect(isAbsent(result)).toBe(true);
  });

  test("a type mismatch is an error, NOT absence", async () => {
    // A wrong-typed override means the source has an opinion it cannot express.
    // Falling through would mask a real configuration bug behind a lower layer.
    await initFeatureFlags({
      environment: DISABLED,
      provider: new StaticProvider({ "wrong-type": "not-a-boolean" }),
    });
    const result = await isEnabled("wrong-type", {
      default: false,
      targetingKey: "service",
    });
    expect(result.errorCode).toBe("TYPE_MISMATCH");
    expect(isAbsent(result)).toBe(false);
  });

  test("resolves string and number flags", async () => {
    await initFeatureFlags({
      environment: DISABLED,
      provider: new StaticProvider({ model: "gpt-5.6-sol", threshold: 0.33 }),
    });
    await expect(
      stringValue("model", { default: "fallback", targetingKey: "service" }),
    ).resolves.toMatchObject({ value: "gpt-5.6-sol", reason: "STATIC" });
    await expect(
      numberValue("threshold", { default: 1, targetingKey: "service" }),
    ).resolves.toMatchObject({ value: 0.33, reason: "STATIC" });
  });
});

describe("initialization", () => {
  test("a provider that fails to initialize does not throw", async () => {
    // A flag backend outage must not stop a service from booting. Evaluations
    // degrade to call-site defaults, which are current production behavior.
    const failing = new StaticProvider({});
    Object.defineProperty(failing, "initialize", {
      value: () => Promise.reject(new Error("backend unreachable")),
    });
    await expect(
      initFeatureFlags({ environment: DISABLED, provider: failing }),
    ).resolves.toBeUndefined();
  });
});
