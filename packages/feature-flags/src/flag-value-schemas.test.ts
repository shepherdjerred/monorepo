import { describe, expect, expectTypeOf, test } from "vitest";
import { flagDeployments } from "./deployments.ts";
import {
  decodeVariantValue,
  encodeVariantValue,
  flagValueEncoding,
  flagValueJsonSchemas,
  flagValueKind,
  flagValueSchema,
  flagValueSchemas,
  validateVariantValue,
  VariantValueError,
} from "./flag-value-schemas.ts";
import { managedFlagInventory } from "./managed-flag-inventory.ts";
import {
  MANAGED_VARIANT_FLAG_KEYS,
  ManagedVariantFlagKeySchema,
} from "./managed-flag-keys.generated.ts";
import { projectDeploymentFlags } from "./project-deployment.ts";

function declaredVariantValues(): {
  key: string;
  where: string;
  raw: string;
}[] {
  const values = managedFlagInventory.flags.flatMap((flag) =>
    flag.type === "variant"
      ? [{ key: flag.key, where: "default", raw: flag.default }]
      : [],
  );
  for (const environment of managedFlagInventory.environments) {
    for (const override of environment.overrides) {
      if (override.type === "variant") {
        values.push({
          key: override.key,
          where: `${environment.key} override`,
          raw: override.default,
        });
      }
    }
  }
  for (const deployment of flagDeployments) {
    for (const flag of projectDeploymentFlags(deployment)) {
      if (flag.type === "variant") {
        values.push({
          key: flag.key,
          where: `${deployment.id} projection`,
          raw: flag.value,
        });
      }
    }
  }
  return values;
}

describe("flagValueSchemas", () => {
  test("registers exactly the managed variant keys", () => {
    expect(Object.keys(flagValueSchemas).toSorted()).toEqual(
      [...MANAGED_VARIANT_FLAG_KEYS].toSorted(),
    );
  });

  test("every declared default, override, and projected value decodes", () => {
    const failures = declaredVariantValues().flatMap(({ key, where, raw }) => {
      const result = validateVariantValue(
        ManagedVariantFlagKeySchema.parse(key),
        raw,
      );
      return result.ok ? [] : [{ key, where, raw, issues: result.issues }];
    });
    expect(failures).toEqual([]);
  });

  test("encode/decode round-trips every declared value", () => {
    for (const { key, raw } of declaredVariantValues()) {
      const flag = ManagedVariantFlagKeySchema.parse(key);
      const decoded = decodeVariantValue(flag, raw);
      const encoded = encodeVariantValue(flag, decoded);
      expect(decodeVariantValue(flag, encoded)).toEqual(decoded);
      expect(encodeVariantValue(flag, decodeVariantValue(flag, encoded))).toBe(
        encoded,
      );
    }
  });

  test("decodes each encoding to a typed value", () => {
    const environments: string[] = decodeVariantValue(
      "delivery-enabled-environments",
      '["delivery/prod"]',
    );
    const lease: number = decodeVariantValue("delivery-lease-seconds", "900");
    const mode: "observe" | "enforce" = decodeVariantValue(
      "scout-riot-budget-mode",
      "enforce",
    );
    const mail = decodeVariantValue("mail-settings", "{}");
    expect(environments).toEqual(["delivery/prod"]);
    expect(lease).toBe(900);
    expect(mode).toBe("enforce");
    expect(mail).toEqual({
      retentionDays: 30,
      maxPerClientPerTenMinutes: 200,
      allowCleartextSmtpAuth: false,
    });
    expectTypeOf(
      decodeVariantValue("delivery-lease-seconds", "900"),
    ).toEqualTypeOf<number>();
    expectTypeOf(
      decodeVariantValue("storm-forum-season", "auto"),
    ).not.toEqualTypeOf<string>();
  });

  test("accepts an explicit empty Home Assistant selection", () => {
    for (const key of [
      "trmnl-ha-presence-entities",
      "trmnl-ha-security-entities",
      "trmnl-ha-climate-entities",
    ] as const) {
      expect(validateVariantValue(key, "")).toEqual({ ok: true });
      expect(decodeVariantValue(key, "")).toBe("");
    }
  });

  test("encodes canonically", () => {
    expect(encodeVariantValue("delivery-lease-seconds", 900)).toBe("900");
    expect(encodeVariantValue("birmel-llm-decisions-threshold", 0.25)).toBe(
      "0.25",
    );
    expect(
      encodeVariantValue("delivery-operator-logins", ["a@example.com"]),
    ).toBe('["a@example.com"]');
    expect(encodeVariantValue("mail-settings", { retentionDays: 7 })).toBe(
      '{"retentionDays":7,"maxPerClientPerTenMinutes":200,"allowCleartextSmtpAuth":false}',
    );
    expect(() => encodeVariantValue("delivery-lease-seconds", 30)).toThrow(
      VariantValueError,
    );
  });

  test.each([
    ["delivery-lease-seconds", "30", ""],
    ["delivery-lease-seconds", " 900", ""],
    ["delivery-lease-seconds", "9e999", ""],
    ["delivery-lease-seconds", "0x10", ""],
    ["delivery-executor-concurrency", "4.5", ""],
    ["delivery-enabled-environments", "delivery/prod", ""],
    ["delivery-enabled-environments", '["ok",""]', "/1"],
    ["media-shared-discord-channel-id", "general", ""],
    ["media-email-sender", "not-an-email", ""],
    ["storm-forum-season", "monsoon", ""],
    ["birmel-llm-model", " gpt-6-luna", ""],
    ["scout-riot-budget-mode", "block", ""],
    ["scout-client-minimum-version", "1.0", ""],
    ["storm-brain-conversation-model", "gpt-6.1-sol", ""],
    ["temporal-email-sender", "Deps <deps@>", ""],
    ["trmnl-ha-presence-entities", "person.jerred:Jerred,", ""],
    ["explore-guild-allowlist", "123,abc", ""],
    ["temporal-agent-chat-photon-owners", "a,,b", ""],
    [
      "scout-explore-quota-limits",
      '{"userMinute":4,"userHour":30,"userDay":100,"userWeek":300,"globalHour":10,"globalDay":600,"globalWeek":2000}',
      "/userHour",
    ],
    [
      "scout-explore-spend-policy",
      '{"globalMonthlyMicros":-1,"userMonthlyMicros":1,"turnMicros":1}',
      "/globalMonthlyMicros",
    ],
    [
      "the-storm-reddit-outreach-settings",
      '{"subreddits":["ok_name","x"],"maxPostAgeHours":1,"maxPostsPerSweep":1,"maxRepliesPerSweep":0,"maxRepliesPerDay":0}',
      "/subreddits/1",
    ],
    [
      "temporal-code-review-settings",
      '{"weights":{"codex":1,"copilot":1}}',
      "/weights",
    ],
    ["mail-settings", '{"retentionDays":0}', "/retentionDays"],
    ["mail-settings", "{", ""],
  ] as const)("rejects %s = %s at path %j", (key, raw, path) => {
    const result = validateVariantValue(key, raw);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.issues.map((issue) => issue.path)).toContain(path);
    for (const issue of result.issues) {
      expect(issue.message.length).toBeGreaterThan(0);
    }
    expect(() => decodeVariantValue(key, raw)).toThrow(VariantValueError);
  });

  test("VariantValueError names the key, path, and message", () => {
    try {
      decodeVariantValue("mail-settings", '{"retentionDays":0}');
      throw new Error("expected decode to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(VariantValueError);
      if (!(error instanceof VariantValueError)) return;
      expect(error.key).toBe("mail-settings");
      expect(error.message).toContain('"mail-settings"');
      expect(error.message).toContain("/retentionDays:");
    }
  });
});

describe("flagValueSchema", () => {
  test("string keys accept the string and reject other types", () => {
    const schema = flagValueSchema("scout-riot-budget-mode");
    expect(schema.parse("observe")).toBe("observe");
    expect(schema.safeParse("block").success).toBe(false);
    expect(schema.safeParse(1).success).toBe(false);
  });

  test("number keys accept numbers and decimal strings like the coercing consumers", () => {
    const schema = flagValueSchema("delivery-lease-seconds");
    expect(schema.parse(900)).toBe(900);
    expect(schema.parse("900")).toBe(900);
    expect(schema.safeParse(30).success).toBe(false);
    expect(schema.safeParse("").success).toBe(false);
    expect(schema.safeParse("nine hundred").success).toBe(false);
  });

  test("json keys accept JSON text and decoded defaults like StringListSchema", () => {
    const schema = flagValueSchema("delivery-enabled-environments");
    expect(schema.parse("[]")).toEqual([]);
    expect(schema.parse('["delivery/prod"]')).toEqual(["delivery/prod"]);
    expect(schema.parse(["delivery/prod"])).toEqual(["delivery/prod"]);
    expect(schema.safeParse("not json").success).toBe(false);
    expect(schema.safeParse('[""]').success).toBe(false);
  });

  test("json defaults fill omitted object fields", () => {
    expect(
      flagValueSchema("the-storm-promotion-settings").parse(
        '{"model":"gpt-6-luna","maxSteps":80,"timeoutMinutes":15,"monthlySolverUsd":10,"enabledTargets":[]}',
      ),
    ).toMatchObject({ dailySpendUsd: 5 });
  });
});

describe("flagValueKind and encodings", () => {
  test("number encodings read as number; string and json read as string", () => {
    for (const key of MANAGED_VARIANT_FLAG_KEYS) {
      expect(flagValueKind(key)).toBe(
        flagValueEncoding(key) === "number" ? "number" : "string",
      );
    }
    expect(flagValueKind("delivery-lease-seconds")).toBe("number");
    expect(flagValueKind("delivery-enabled-environments")).toBe("string");
  });

  test("every key exports a draft 2020-12 JSON Schema", () => {
    const schemas = flagValueJsonSchemas();
    expect(Object.keys(schemas)).toEqual(
      [...MANAGED_VARIANT_FLAG_KEYS].toSorted((left, right) =>
        left < right ? -1 : 1,
      ),
    );
    for (const entry of Object.values(schemas)) {
      expect(entry.schema["$schema"]).toBe(
        "https://json-schema.org/draft/2020-12/schema",
      );
    }
    expect(schemas["delivery-lease-seconds"]).toEqual({
      encoding: "number",
      schema: {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        type: "integer",
        minimum: 60,
        maximum: 7200,
      },
    });
  });

  test("generated JSON Schema file matches the registry", async () => {
    const { generateFlagValueSchemasJson } =
      await import("../scripts/generate-flag-types.ts");
    const onDisk = await Bun.file(
      new URL("flag-value-schemas.generated.json", import.meta.url),
    ).text();
    expect(onDisk).toBe(await generateFlagValueSchemasJson());
  });
});
