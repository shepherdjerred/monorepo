import { describe, expect, test } from "vitest";
import { BootstrapSchema } from "./config.ts";

const databaseUrl = "postgresql://golink-postgresql:5432/golink_db";

describe("BootstrapSchema feature-flag mode", () => {
  test.each(["flags", "static", "disabled"] as const)("accepts %s", (mode) => {
    const parsed = BootstrapSchema.parse({
      DATABASE_URL: databaseUrl,
      FEATURE_FLAGS_MODE: mode,
    });
    expect(parsed.FEATURE_FLAGS_MODE).toBe(mode);
  });

  test("treats an empty mode as unset", () => {
    const parsed = BootstrapSchema.parse({
      DATABASE_URL: databaseUrl,
      FEATURE_FLAGS_MODE: "",
    });
    expect(parsed.FEATURE_FLAGS_MODE).toBeUndefined();
  });

  test.each(["legacy", "maybe"] as const)(
    "rejects %s outside the shared flag client contract",
    (mode) => {
      expect(() =>
        BootstrapSchema.parse({
          DATABASE_URL: databaseUrl,
          FEATURE_FLAGS_MODE: mode,
        }),
      ).toThrow(/FEATURE_FLAGS_MODE/);
    },
  );
});
