import { describe, expect, test } from "vitest";
import { z } from "zod";

import {
  AgentOutputSchema,
  AgentOutputWireSchema,
  ConfigSchema,
} from "#src/domain/schemas.ts";

function stringFormats(value: unknown, found: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) stringFormats(item, found);
  } else if (value !== null && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      if (key === "format" && typeof entry === "string") found.push(entry);
      else stringFormats(entry, found);
    }
  }
  return found;
}

const VALID_OUTPUT = {
  status: "changed",
  commitTitle: "fix(git-spice): pass an explicit merge method",
  summary: "summary",
  verification: ["bun test"],
  resolvedFindingKeys: [],
  visualTargets: [],
};

const StrictObjectSchema = z.object({
  type: z.string(),
  properties: z.record(z.string(), z.unknown()),
  required: z.array(z.string()).optional(),
});

describe("Woodpecker bootstrap configuration", () => {
  test.each([
    {},
    { baseUrl: "https://woodpecker.sjer.red" },
    { repoId: 1 },
    { baseUrl: "not-a-url", repoId: 1 },
    { baseUrl: "https://woodpecker.sjer.red", repoId: 0 },
    { baseUrl: "https://woodpecker.sjer.red", repoId: 1.5 },
  ])(
    "rejects incomplete or invalid CI connection details: %j",
    async (fields) => {
      const config: unknown = await Bun.file(
        new URL("../../config.example.json", import.meta.url),
      ).json();
      const valid = ConfigSchema.parse(config);
      expect(() =>
        ConfigSchema.parse({
          ...valid,
          woodpecker: { apiToken: valid.woodpecker.apiToken, ...fields },
        }),
      ).toThrow();
    },
  );
});

function childEntries(value: unknown): [string, unknown][] {
  const asArray = z.array(z.unknown()).safeParse(value);
  return asArray.success
    ? asArray.data.map((item, index): [string, unknown] => [
        String(index),
        item,
      ])
    : recordEntries(value);
}

function recordEntries(value: unknown): [string, unknown][] {
  const asRecord = z.record(z.string(), z.unknown()).safeParse(value);
  return asRecord.success ? Object.entries(asRecord.data) : [];
}

function missingRequired(value: unknown, path = "$"): string[] {
  const parsed = StrictObjectSchema.safeParse(value);
  const node =
    parsed.success && parsed.data.type === "object" ? parsed.data : undefined;
  const uncovered =
    node === undefined
      ? []
      : Object.keys(node.properties).filter(
          (key) => !(node.required ?? []).includes(key),
        );
  return [
    ...uncovered.map((key) => `${path}.${key}`),
    ...childEntries(value).flatMap(([key, entry]) =>
      missingRequired(entry, `${path}.${key}`),
    ),
  ];
}

describe("Agent output schema", () => {
  test("emits no string formats for structured-output providers", () => {
    expect(stringFormats(z.toJSONSchema(AgentOutputSchema))).toEqual([]);
    expect(stringFormats(z.toJSONSchema(AgentOutputWireSchema))).toEqual([]);
  });

  test("wire schema lists every property as required", () => {
    expect(missingRequired(z.toJSONSchema(AgentOutputWireSchema))).toEqual([]);
  });

  test("routes must start with a slash", () => {
    expect(
      AgentOutputSchema.parse({
        ...VALID_OUTPUT,
        visualTargets: [{ package: "x", route: "/y", name: "z" }],
      }).visualTargets,
    ).toHaveLength(1);
    expect(() =>
      AgentOutputSchema.parse({
        ...VALID_OUTPUT,
        visualTargets: [{ package: "x", route: "y", name: "z" }],
      }),
    ).toThrow();
  });
});
