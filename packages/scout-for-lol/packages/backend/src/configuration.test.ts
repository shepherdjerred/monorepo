import { describe, test, expect, afterEach } from "vitest";
import {
  parseProductAnalyticsConfiguration,
  resetConfigurationForTests,
  resolveEnvironment,
} from "#src/configuration.ts";
import configuration from "#src/configuration.ts";

Bun.env["TEMPORAL_NAMESPACE"] ??= "dev";

type TrackedKey =
  | "ENVIRONMENT"
  | "NODE_ENV"
  | "ENABLE_DISCORD_GATEWAY"
  | "ENABLE_BACKGROUND_JOBS"
  | "TEMPORAL_ADDRESS"
  | "TEMPORAL_NAMESPACE"
  | "TEMPORAL_SCHEDULE_RECONCILIATION"
  | "BB_ASK_MODEL"
  | "EXPLORE_MODEL";

function snapshotEnv(): Record<TrackedKey, string | undefined> {
  return {
    ENVIRONMENT: Bun.env["ENVIRONMENT"],
    NODE_ENV: Bun.env.NODE_ENV,
    ENABLE_DISCORD_GATEWAY: Bun.env["ENABLE_DISCORD_GATEWAY"],
    ENABLE_BACKGROUND_JOBS: Bun.env["ENABLE_BACKGROUND_JOBS"],
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
      key === "ENABLE_DISCORD_GATEWAY" ||
      key === "ENABLE_BACKGROUND_JOBS" ||
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

  test("allows secondary development instances to disable gateway and jobs", () => {
    Bun.env["ENVIRONMENT"] = "dev";
    Bun.env["ENABLE_DISCORD_GATEWAY"] = "false";
    Bun.env["ENABLE_BACKGROUND_JOBS"] = "false";
    resetConfigurationForTests();

    expect(configuration.enableDiscordGateway).toBe(false);
    expect(configuration.enableBackgroundJobs).toBe(false);
    expect(configuration.temporalAddress).toBeUndefined();
    expect(configuration.temporalNamespace).toBe("dev");
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
  });

  test("rejects disabled gateway or jobs outside development", () => {
    Bun.env["ENVIRONMENT"] = "beta";
    Bun.env["ENABLE_DISCORD_GATEWAY"] = "false";
    resetConfigurationForTests();

    expect(() => configuration.enableDiscordGateway).toThrow(
      /may only be disabled in environment=dev/,
    );
  });

  test("rejects background jobs enabled while the gateway is disabled", () => {
    Bun.env["ENVIRONMENT"] = "dev";
    Bun.env["ENABLE_DISCORD_GATEWAY"] = "false";
    Bun.env["ENABLE_BACKGROUND_JOBS"] = "true";
    resetConfigurationForTests();

    expect(() => configuration.enableBackgroundJobs).toThrow(
      /ENABLE_BACKGROUND_JOBS requires ENABLE_DISCORD_GATEWAY/,
    );
  });

  test("defaults Bryan Bucks analysis to GPT-5.6 Luna and accepts an override", () => {
    delete Bun.env["BB_ASK_MODEL"];
    resetConfigurationForTests();
    expect(configuration.bucksAskModel).toBe("gpt-5.6-luna");

    Bun.env["BB_ASK_MODEL"] = "gpt-5.6-terra";
    resetConfigurationForTests();
    expect(configuration.bucksAskModel).toBe("gpt-5.6-terra");
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
