import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { parseWithUnknownKeyFallback } from "#src/league/api/strict-with-loose-fallback.ts";

const InnerSchema = z
  .object({
    id: z.number(),
    label: z.string(),
  })
  .strict();

const OuterSchema = z
  .object({
    name: z.string(),
    items: z.array(InnerSchema),
    nested: z
      .object({
        flag: z.boolean(),
      })
      .strict(),
  })
  .strict();

describe("parseWithUnknownKeyFallback", () => {
  test("valid payload returns ok with no stripped paths", () => {
    const payload = {
      name: "x",
      items: [{ id: 1, label: "a" }],
      nested: { flag: true },
    };
    const result = parseWithUnknownKeyFallback(OuterSchema, payload);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.data).toEqual(payload);
    expect(result.unknownKeyPaths).toEqual([]);
  });

  test("strips one extra top-level key and reports the path", () => {
    const payload = {
      name: "x",
      items: [{ id: 1, label: "a" }],
      nested: { flag: true },
      extra: "remove me",
    };
    const result = parseWithUnknownKeyFallback(OuterSchema, payload);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.data.name).toBe("x");
    expect(result.data.items).toEqual([{ id: 1, label: "a" }]);
    expect(result.unknownKeyPaths).toEqual(["extra"]);
  });

  test("strips extras nested inside arrays", () => {
    const payload = {
      name: "x",
      items: [
        { id: 1, label: "a", surprise: true, alsoNew: 42 },
        { id: 2, label: "b" },
        { id: 3, label: "c", surprise: false },
      ],
      nested: { flag: true },
    };
    const result = parseWithUnknownKeyFallback(OuterSchema, payload);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.data.items).toEqual([
      { id: 1, label: "a" },
      { id: 2, label: "b" },
      { id: 3, label: "c" },
    ]);
    // Two unknown keys at items[0], one at items[2]
    expect(result.unknownKeyPaths.toSorted()).toEqual(
      ["items[0].alsoNew", "items[0].surprise", "items[2].surprise"].toSorted(),
    );
  });

  test("strips extras inside nested object", () => {
    const payload = {
      name: "x",
      items: [{ id: 1, label: "a" }],
      nested: { flag: true, debug: "hi" },
    };
    const result = parseWithUnknownKeyFallback(OuterSchema, payload);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.unknownKeyPaths).toEqual(["nested.debug"]);
  });

  test("real schema break is returned untouched (no recovery)", () => {
    const payload = {
      name: "x",
      items: [{ id: "not-a-number", label: "a" }],
      nested: { flag: true },
    };
    const result = parseWithUnknownKeyFallback(OuterSchema, payload);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.issues.some((i) => i.code === "invalid_type")).toBe(
      true,
    );
  });

  test("mixed real-break + extra keys does not silently recover", () => {
    const payload = {
      name: "x",
      items: [{ id: "wrong", label: "a", extra: "ignored-by-design" }],
      nested: { flag: true },
    };
    const result = parseWithUnknownKeyFallback(OuterSchema, payload);
    expect(result.ok).toBe(false);
  });

  test("does not mutate the original payload", () => {
    const payload = {
      name: "x",
      items: [{ id: 1, label: "a", surprise: true }],
      nested: { flag: true },
      extra: "removable",
    };
    const beforeJson = JSON.stringify(payload);
    const result = parseWithUnknownKeyFallback(OuterSchema, payload);
    expect(result.ok).toBe(true);
    expect(JSON.stringify(payload)).toBe(beforeJson);
  });
});
