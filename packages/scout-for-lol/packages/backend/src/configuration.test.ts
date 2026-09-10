import { describe, test, expect, afterEach } from "vitest";
import {
  parseProductAnalyticsConfiguration,
  parseVoiceAssistantConfiguration,
  resetConfigurationForTests,
  resolveEnvironment,
} from "#src/configuration.ts";
import configuration from "#src/configuration.ts";
import { SCOUT_RUNTIME_ROLES } from "#src/configuration/runtime-role.ts";

Bun.env["TEMPORAL_NAMESPACE"] ??= "dev";

type TrackedKey =
  | "ENVIRONMENT"
  | "NODE_ENV"
  | "SCOUT_RUNTIME_ROLE"
  | "SCOUT_DEV_SKIP_REPORT_LAKE_FOLD"
  | "TEMPORAL_ADDRESS"
  | "TEMPORAL_NAMESPACE"
  | "TEMPORAL_SCHEDULE_RECONCILIATION"
  | "BB_ASK_MODEL"
  | "EXPLORE_MODEL";

function snapshotEnv(): Record<TrackedKey, string | undefined> {
  return {
    ENVIRONMENT: Bun.env["ENVIRONMENT"],
    NODE_ENV: Bun.env.NODE_ENV,
    SCOUT_RUNTIME_ROLE: Bun.env["SCOUT_RUNTIME_ROLE"],
    SCOUT_DEV_SKIP_REPORT_LAKE_FOLD: Bun.env["SCOUT_DEV_SKIP_REPORT_LAKE_FOLD"],
    TEMPORAL_ADDRESS: Bun.env["TEMPORAL_ADDRESS"],
    TEMPORAL_NAMESPACE: Bun.env["TEMPORAL_NAMESPACE"],
    TEMPORAL_SCHEDULE_RECONCILIATION:
      Bun.env["TEMPORAL_SCHEDULE_RECONCILIATION"],
    BB_ASK_MODEL: Bun.env["BB_ASK_MODEL"],
    EXPLORE_MODEL: Bun.env["EXPLORE_MODEL"],
  };
}

function restoreEnvKey(key: TrackedKey, value: string | undefined): void {
  if (value === undefined) {
    Reflect.deleteProperty(Bun.env, key);
  } else {
    Bun.env[key] = value;
  }
}

function restoreEnv(snapshot: Record<TrackedKey, string | undefined>) {
  for (const key of Object.keys(snapshot)) {
    if (
      key === "ENVIRONMENT" ||
      key === "NODE_ENV" ||
      key === "SCOUT_RUNTIME_ROLE" ||
      key === "SCOUT_DEV_SKIP_REPORT_LAKE_FOLD" ||
      key === "TEMPORAL_ADDRESS" ||
      key === "TEMPORAL_NAMESPACE" ||
      key === "TEMPORAL_SCHEDULE_RECONCILIATION" ||
      key === "BB_ASK_MODEL" ||
      key === "EXPLORE_MODEL"
    ) {
      restoreEnvKey(key, snapshot[key]);
    }
  }
  resetConfigurationForTests();
}

describe("resolveEnvironment", () => {
  const initial = snapshotEnv();

  afterEach(() => {
    restoreEnv(initial);
  });

  test("returns parsed value for each valid enum", () => {
    for (const value of ["dev", "beta", "prod"] as const) {
      Bun.env["ENVIRONMENT"] = value;
      expect(resolveEnvironment()).toBe(value);
    }
  });

  test("falls back to 'dev' when ENVIRONMENT is unset", () => {
    delete Bun.env["ENVIRONMENT"];
    expect(resolveEnvironment()).toBe("dev");
  });

  test("throws on invalid value under NODE_ENV=test", () => {
    Bun.env["ENVIRONMENT"] = "production"; // not in the enum
    Bun.env.NODE_ENV = "test";
    expect(() => resolveEnvironment()).toThrow(/Invalid ENVIRONMENT/);
  });

  test("throws on invalid value when not in test mode", () => {
    Bun.env["ENVIRONMENT"] = "production";
    Bun.env.NODE_ENV = "development";
    expect(() => resolveEnvironment()).toThrow(/Invalid ENVIRONMENT/);
  });
});

describe("parseProductAnalyticsConfiguration", () => {
  const complete = {
    projectToken: "phc_test",
    apiHost: "https://us.i.posthog.com",
    siteKey: "scout-beta",
    siteHostname: "beta.scout-for-lol.com",
  };

  test("keeps development analytics disabled even with configuration", () => {
    expect(parseProductAnalyticsConfiguration("dev", complete)).toBeUndefined();
  });

  test.each(["beta", "prod"] as const)(
    "requires complete configuration in %s",
    (environment) => {
      expect(() =>
        parseProductAnalyticsConfiguration(environment, {
          ...complete,
          projectToken: undefined,
        }),
      ).toThrow(/Complete PostHog configuration/);
    },
  );

  test.each(["beta", "prod"] as const)(
    "accepts complete configuration in %s",
    (environment) => {
      expect(parseProductAnalyticsConfiguration(environment, complete)).toEqual(
        complete,
      );
    },
  );
});

describe("local runtime flags", () => {
  const initial = snapshotEnv();

  afterEach(() => {
    restoreEnv(initial);
  });

  test("defaults to the combined runtime role", () => {
    Bun.env["ENVIRONMENT"] = "dev";
    delete Bun.env["SCOUT_RUNTIME_ROLE"];
    resetConfigurationForTests();

    expect(configuration.runtimeRole).toBe("combined");
    expect(configuration.skipReportLakeFold).toBe(false);
    expect(configuration.temporalAddress).toBeUndefined();
    expect(configuration.temporalNamespace).toBe("dev");
  });

  test("lets a secondary development instance run the gatewayless role", () => {
    Bun.env["ENVIRONMENT"] = "dev";
    Bun.env["SCOUT_RUNTIME_ROLE"] = "application";
    Bun.env["SCOUT_DEV_SKIP_REPORT_LAKE_FOLD"] = "true";
    resetConfigurationForTests();

    expect(configuration.runtimeRole).toBe("application");
    expect(configuration.skipReportLakeFold).toBe(true);
  });

  test("accepts every declared runtime role in beta", () => {
    Bun.env["ENVIRONMENT"] = "beta";
    Bun.env["TEMPORAL_NAMESPACE"] = "beta";
    for (const role of SCOUT_RUNTIME_ROLES) {
      Bun.env["SCOUT_RUNTIME_ROLE"] = role;
      resetConfigurationForTests();
      expect(configuration.runtimeRole).toBe(role);
    }
  });

  test("requires an active Temporal namespace", () => {
    delete Bun.env["TEMPORAL_NAMESPACE"];
    resetConfigurationForTests();

    expect(() => configuration.temporalNamespace).toThrow(
      /TEMPORAL_NAMESPACE.*required/,
    );
  });

  test("rejects default as an active Temporal namespace", () => {
    Bun.env["TEMPORAL_NAMESPACE"] = "default";
    resetConfigurationForTests();

    expect(() => configuration.temporalNamespace).toThrow();
  });

  test("requires the active Temporal namespace to match the Scout stage", () => {
    Bun.env["ENVIRONMENT"] = "beta";
    Bun.env["TEMPORAL_NAMESPACE"] = "prod";
    resetConfigurationForTests();

    expect(() => configuration.temporalNamespace).toThrow(
      /TEMPORAL_NAMESPACE=prod must match ENVIRONMENT=beta/,
    );
  });

  test("parses schedule reconciliation mode", () => {
    Bun.env["TEMPORAL_SCHEDULE_RECONCILIATION"] = "disabled";
    resetConfigurationForTests();
    expect(configuration.temporalScheduleReconciliation).toBe("disabled");

    Bun.env["TEMPORAL_SCHEDULE_RECONCILIATION"] = "invalid";
    resetConfigurationForTests();
    expect(() => configuration.temporalScheduleReconciliation).toThrow();

    Bun.env["TEMPORAL_SCHEDULE_RECONCILIATION"] = "auto";
    resetConfigurationForTests();
    expect(configuration.temporalScheduleReconciliation).toBe("auto");
  });

  test("rejects an unrecognised runtime role loudly", () => {
    Bun.env["ENVIRONMENT"] = "dev";
    Bun.env["SCOUT_RUNTIME_ROLE"] = "aplication";
    resetConfigurationForTests();

    // A typo'd role that silently fell back to `combined` would put a second
    // gateway connection and a second report-lake writer into the cluster.
    expect(() => configuration.runtimeRole).toThrow(
      /Invalid SCOUT_RUNTIME_ROLE="aplication", expected one of: combined, application, gateway, activity-worker/,
    );
  });

  test("rejects skipping the boot report-lake fold outside development", () => {
    Bun.env["ENVIRONMENT"] = "beta";
    Bun.env["TEMPORAL_NAMESPACE"] = "beta";
    Bun.env["SCOUT_DEV_SKIP_REPORT_LAKE_FOLD"] = "true";
    resetConfigurationForTests();

    expect(() => configuration.skipReportLakeFold).toThrow(
      /may only be set in environment=dev/,
    );
  });

  test("defaults Scout Explore to GPT-5.6 Luna and accepts an override", () => {
    delete Bun.env["EXPLORE_MODEL"];
    resetConfigurationForTests();
    expect(configuration.exploreModel).toBe("gpt-5.6-luna");

    Bun.env["EXPLORE_MODEL"] = "gpt-5.6-terra";
    resetConfigurationForTests();
    expect(configuration.exploreModel).toBe("gpt-5.6-terra");
  });
});

describe("parseVoiceAssistantConfiguration", () => {
  test("defaults to disabled with the production asset path", () => {
    const config = parseVoiceAssistantConfiguration({
      enabled: false,
      openAiApiKey: undefined,
      assetsDir: undefined,
      kwsRuntime: undefined,
    });
    expect(config).toEqual({
      enabled: false,
      assetsDir: "/opt/scout/voice",
      kwsRuntime: "auto",
    });
  });

  test("enabled requires an OpenAI key", () => {
    expect(() =>
      parseVoiceAssistantConfiguration({
        enabled: true,
        openAiApiKey: undefined,
        assetsDir: undefined,
        kwsRuntime: undefined,
      }),
    ).toThrow(/OPENAI_API_KEY/);
  });

  test("accepts a complete enabled configuration", () => {
    const config = parseVoiceAssistantConfiguration({
      enabled: true,
      openAiApiKey: "sk-test",
      assetsDir: "/tmp/voice",
      kwsRuntime: "wasm",
    });
    expect(config).toEqual({
      enabled: true,
      openAiApiKey: "sk-test",
      assetsDir: "/tmp/voice",
      kwsRuntime: "wasm",
    });
  });

  test("a present invalid runtime throws instead of falling back", () => {
    expect(() =>
      parseVoiceAssistantConfiguration({
        enabled: false,
        openAiApiKey: undefined,
        assetsDir: undefined,
        kwsRuntime: "gpu",
      }),
    ).toThrow();
  });
});
