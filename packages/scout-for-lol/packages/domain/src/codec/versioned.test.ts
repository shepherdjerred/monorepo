import { describe, expect, test } from "vitest";
import { z } from "zod";
import { defineVersionedCodec } from "#src/codec/versioned.ts";

const WidgetV1Schema = z.strictObject({
  widgetId: z.string().min(1),
  count: z.number().int().nonnegative(),
});

const WidgetV2Schema = z.strictObject({
  widgetId: z.string().min(1),
  label: z.string().min(1).optional(),
  count: z.number().int().nonnegative(),
});

const WidgetV3Schema = z.strictObject({
  widgetId: z.string().min(1),
  label: z.string().min(1),
  count: z.number().int().nonnegative(),
});

function migrateWidgetV1ToV2(old: unknown): unknown {
  const v1 = WidgetV1Schema.parse(old);
  return { widgetId: v1.widgetId, count: v1.count };
}

function migrateWidgetV2ToV3(old: unknown): unknown {
  const v2 = WidgetV2Schema.parse(old);
  return {
    widgetId: v2.widgetId,
    label: v2.label ?? "unlabeled",
    count: v2.count,
  };
}

const widgetCodec = defineVersionedCodec({
  kind: "widget",
  version: 3,
  schema: WidgetV3Schema,
  migrations: { 1: migrateWidgetV1ToV2, 2: migrateWidgetV2ToV3 },
});

describe("defineVersionedCodec", () => {
  test("serialize wraps a value in a strict current-version envelope", () => {
    const value = WidgetV3Schema.parse({
      widgetId: "w-1",
      label: "widget one",
      count: 2,
    });
    expect(widgetCodec.serialize(value)).toEqual({
      kind: "widget",
      version: 3,
      data: { widgetId: "w-1", label: "widget one", count: 2 },
    });
  });

  test("parse round-trips a serialized value", () => {
    const value = WidgetV3Schema.parse({
      widgetId: "w-1",
      label: "widget one",
      count: 2,
    });
    expect(widgetCodec.parse(widgetCodec.serialize(value))).toEqual(value);
  });

  test("parse migrates a v1 envelope through every step to current", () => {
    const parsed = widgetCodec.parse({
      kind: "widget",
      version: 1,
      data: { widgetId: "w-1", count: 5 },
    });
    expect(parsed).toEqual({ widgetId: "w-1", label: "unlabeled", count: 5 });
  });

  test("parse migrates a v2 envelope one step forward", () => {
    const parsed = widgetCodec.parse({
      kind: "widget",
      version: 2,
      data: { widgetId: "w-2", label: "kept", count: 1 },
    });
    expect(parsed).toEqual({ widgetId: "w-2", label: "kept", count: 1 });
  });

  test("parse rejects an unknown kind", () => {
    expect(() =>
      widgetCodec.parse({
        kind: "gadget",
        version: 3,
        data: { widgetId: "w-1", label: "widget one", count: 2 },
      }),
    ).toThrow();
  });

  test("parse rejects a version above the current one", () => {
    expect(() =>
      widgetCodec.parse({
        kind: "widget",
        version: 4,
        data: { widgetId: "w-1", label: "widget one", count: 2 },
      }),
    ).toThrow(/unknown widget envelope version 4/);
  });

  test("parse rejects a version below the oldest supported one", () => {
    const noMigrationCodec = defineVersionedCodec({
      kind: "widget",
      version: 2,
      schema: WidgetV2Schema,
    });
    expect(() =>
      noMigrationCodec.parse({
        kind: "widget",
        version: 1,
        data: { widgetId: "w-1", count: 5 },
      }),
    ).toThrow(/unknown widget envelope version 1/);
  });

  test("parse rejects a non-integer version", () => {
    expect(() =>
      widgetCodec.parse({
        kind: "widget",
        version: 2.5,
        data: { widgetId: "w-1", label: "widget one", count: 2 },
      }),
    ).toThrow();
  });

  test("parse rejects an envelope with extra keys", () => {
    expect(() =>
      widgetCodec.parse({
        kind: "widget",
        version: 3,
        data: { widgetId: "w-1", label: "widget one", count: 2 },
        checksum: "abc",
      }),
    ).toThrow();
  });

  test("parse rejects an envelope with no data payload", () => {
    expect(() => widgetCodec.parse({ kind: "widget", version: 3 })).toThrow();
  });

  test("parse rejects current-version data failing the current schema", () => {
    expect(() =>
      widgetCodec.parse({
        kind: "widget",
        version: 3,
        data: { widgetId: "w-1", label: "", count: 2 },
      }),
    ).toThrow();
  });

  test("parse rejects migrated data failing the current schema", () => {
    const brokenMigrationCodec = defineVersionedCodec({
      kind: "widget",
      version: 2,
      schema: WidgetV2Schema,
      migrations: { 1: () => ({ bogus: true }) },
    });
    expect(() =>
      brokenMigrationCodec.parse({
        kind: "widget",
        version: 1,
        data: { widgetId: "w-1", count: 5 },
      }),
    ).toThrow();
  });

  test("serialize re-validates and rejects a runtime-invalid value", () => {
    const value = WidgetV3Schema.parse({
      widgetId: "w-1",
      label: "widget one",
      count: 2,
    });
    expect(() => widgetCodec.serialize({ ...value, count: 2.5 })).toThrow();
  });

  test("a codec with a partial contiguous chain supports only that range", () => {
    const partialCodec = defineVersionedCodec({
      kind: "widget",
      version: 3,
      schema: WidgetV3Schema,
      migrations: { 2: migrateWidgetV2ToV3 },
    });
    expect(
      partialCodec.parse({
        kind: "widget",
        version: 2,
        data: { widgetId: "w-2", count: 1 },
      }),
    ).toEqual({ widgetId: "w-2", label: "unlabeled", count: 1 });
    expect(() =>
      partialCodec.parse({
        kind: "widget",
        version: 1,
        data: { widgetId: "w-1", count: 5 },
      }),
    ).toThrow(/unknown widget envelope version 1/);
  });

  test("parse cleanly rejects an envelope with no version field", () => {
    expect(() =>
      widgetCodec.parse({
        kind: "widget",
        data: { widgetId: "w-1", label: "widget one", count: 2 },
      }),
    ).toThrow(/version/);
  });

  test("a throwing migration surfaces its own error identifiably", () => {
    const throwingMigrationCodec = defineVersionedCodec({
      kind: "widget",
      version: 3,
      schema: WidgetV3Schema,
      migrations: {
        1: () => {
          throw new Error("widget v1 payload is corrupt beyond migration");
        },
        2: migrateWidgetV2ToV3,
      },
    });
    expect(() =>
      throwingMigrationCodec.parse({
        kind: "widget",
        version: 1,
        data: { widgetId: "w-1", count: 5 },
      }),
    ).toThrow(/widget v1 payload is corrupt beyond migration/);
    expect(
      throwingMigrationCodec.parse({
        kind: "widget",
        version: 2,
        data: { widgetId: "w-2", count: 1 },
      }),
    ).toEqual({ widgetId: "w-2", label: "unlabeled", count: 1 });
  });
});

describe("defineVersionedCodec definition validation", () => {
  test("definition rejects a version below 1", () => {
    expect(() =>
      defineVersionedCodec({
        kind: "widget",
        version: 0,
        schema: WidgetV1Schema,
      }),
    ).toThrow();
  });

  test("definition rejects a non-integer version", () => {
    expect(() =>
      defineVersionedCodec({
        kind: "widget",
        version: 1.5,
        schema: WidgetV1Schema,
      }),
    ).toThrow();
  });

  test("definition rejects an empty kind", () => {
    expect(() =>
      defineVersionedCodec({ kind: "", version: 1, schema: WidgetV1Schema }),
    ).toThrow();
  });

  test("definition rejects a migration from the current or later version", () => {
    expect(() =>
      defineVersionedCodec({
        kind: "widget",
        version: 3,
        schema: WidgetV3Schema,
        migrations: { 3: migrateWidgetV2ToV3 },
      }),
    ).toThrow();
  });

  test("definition rejects a migration table with a gap", () => {
    expect(() =>
      defineVersionedCodec({
        kind: "widget",
        version: 3,
        schema: WidgetV3Schema,
        migrations: { 1: migrateWidgetV1ToV2 },
      }),
    ).toThrow(/contiguous/);
  });

  test("definition rejects any migrations on a version-1 codec", () => {
    expect(() =>
      defineVersionedCodec({
        kind: "widget",
        version: 1,
        schema: WidgetV1Schema,
        migrations: { 1: migrateWidgetV1ToV2 },
      }),
    ).toThrow();
  });
});
