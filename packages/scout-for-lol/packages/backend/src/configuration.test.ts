import { describe, test, expect, afterEach } from "bun:test";
import {
  parseProductAnalyticsConfiguration,
  resolveEnvironment,
} from "#src/configuration.ts";

type TrackedKey = "ENVIRONMENT" | "NODE_ENV";

function snapshotEnv(): Record<TrackedKey, string | undefined> {
  return {
    ENVIRONMENT: Bun.env["ENVIRONMENT"],
    NODE_ENV: Bun.env.NODE_ENV,
  };
}

function restoreEnv(snapshot: Record<TrackedKey, string | undefined>) {
  if (snapshot.ENVIRONMENT === undefined) {
    delete Bun.env["ENVIRONMENT"];
  } else {
    Bun.env["ENVIRONMENT"] = snapshot.ENVIRONMENT;
  }
  if (snapshot.NODE_ENV === undefined) {
    delete Bun.env.NODE_ENV;
  } else {
    Bun.env.NODE_ENV = snapshot.NODE_ENV;
  }
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
