import { FeatureFlagModeSchema } from "@shepherdjerred/feature-flags/config/schema.ts";
import { describe, expect, test } from "vitest";
import { BootstrapSchema } from "./config.ts";

const DATABASE_URL =
  "postgresql://golink:secret@golink-postgresql:5432/golink_db";

describe("BootstrapSchema", () => {
  test.each(FeatureFlagModeSchema.options)(
    "accepts the shared feature-flag mode %s",
    (mode) => {
      const config = BootstrapSchema.parse({
        DATABASE_URL,
        FEATURE_FLAGS_MODE: mode,
      });

      expect(config.FEATURE_FLAGS_MODE).toBe(mode);
    },
  );

  test("accepts the first-party Flags bootstrap the golink chart renders", () => {
    const config = BootstrapSchema.parse({
      DATABASE_URL,
      FEATURE_FLAGS_MODE: "flags",
      FLAGS_URL: "http://flags.flags.svc.cluster.local:7361",
      FLAGS_DEPLOYMENT: "golink/prod",
    });

    expect(config.FEATURE_FLAGS_MODE).toBe("flags");
  });

  test("rejects an unknown feature-flag mode", () => {
    expect(() =>
      BootstrapSchema.parse({
        DATABASE_URL,
        FEATURE_FLAGS_MODE: "launchdarkly",
      }),
    ).toThrow();
  });
});
