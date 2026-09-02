import { describe, expect, test } from "vitest";
import YAML from "yaml";
import { z } from "zod";
import { renderFliptFeatures } from "./flipt-features-renderer.ts";
import { ManagedFlagInventorySchema } from "./managed-flag-inventory.ts";

const RenderedFeaturesSchema = z.object({
  version: z.literal("1.6"),
  namespace: z.object({
    key: z.string(),
    name: z.string(),
    description: z.string(),
  }),
  flags: z.array(z.record(z.string(), z.unknown())),
  segments: z.array(
    z.object({
      key: z.string(),
      match_type: z.string(),
      constraints: z.array(
        z.object({
          type: z.string(),
          property: z.string(),
          operator: z.string(),
          value: z.string(),
        }),
      ),
    }),
  ),
});

function parseRendered(environment: string, namespace: string) {
  const parsed: unknown = YAML.parse(
    renderFliptFeatures(environment, namespace),
  );
  return RenderedFeaturesSchema.parse(parsed);
}

function testInventory(flags: unknown[]) {
  return ManagedFlagInventorySchema.parse({
    version: 3,
    namespaces: [{ key: "test", name: "Test", description: "Test namespace." }],
    environments: [
      { key: "beta", overrides: [] },
      { key: "prod", overrides: [] },
    ],
    flags,
    exemptions: [],
  });
}

const behavior = {
  rollouts: [],
  rules: [],
  thresholdRollouts: [],
};

function metadata(key: string) {
  return {
    key,
    owner: "test",
    namespace: "test",
    source: "test",
    purpose: `Test ${key}.`,
  };
}

function booleanRollouts(value: string) {
  return [
    {
      segmentKey: "shared",
      segmentOperator: "OR_SEGMENT_OPERATOR",
      matchType: "ALL_SEGMENT_MATCH_TYPE",
      constraints: [
        {
          type: "STRING_CONSTRAINT_COMPARISON_TYPE",
          property: "role",
          operator: "eq",
          value,
        },
      ],
      result: true,
    },
  ];
}

describe("renderFliptFeatures", () => {
  test("renders every managed namespace in both environments", () => {
    const namespaces = [
      "scout",
      "birmel",
      "streambot",
      "starlight-karma-bot",
      "trmnl-dashboard",
      "temporal",
    ];
    for (const environment of ["beta", "prod"]) {
      for (const namespace of namespaces) {
        const rendered = parseRendered(environment, namespace);
        expect(rendered.namespace.key).toBe(namespace);
        expect(rendered.flags.length).toBeGreaterThan(0);
      }
    }
  });

  test("renders intended Scout defaults and declarative segment enums", () => {
    const rendered = parseRendered("beta", "scout");
    expect(rendered.flags).toContainEqual(
      expect.objectContaining({
        key: "scout-explore-model",
        type: "VARIANT_FLAG_TYPE",
        variants: [
          {
            default: true,
            key: "gpt-5.6-luna",
            name: "gpt-5.6-luna",
            attachment: {},
          },
        ],
      }),
    );
    expect(rendered.segments).toContainEqual(
      expect.objectContaining({
        key: "scout-guild-1337623164146155593",
        match_type: "ALL_MATCH_TYPE",
        constraints: [
          expect.objectContaining({ type: "STRING_COMPARISON_TYPE" }),
        ],
      }),
    );
  });

  test("renders rules, variants, attachments, and threshold ranks", () => {
    const inventory = testInventory([
      {
        ...metadata("variant"),
        type: "variant",
        default: "blue",
        rollouts: [],
        thresholdRollouts: [],
        rules: [
          {
            rank: 0,
            segmentOperator: "OR_SEGMENT_OPERATOR",
            segments: [
              {
                key: "operators",
                matchType: "ALL_SEGMENT_MATCH_TYPE",
                constraints: [
                  {
                    type: "STRING_CONSTRAINT_COMPARISON_TYPE",
                    property: "role",
                    operator: "eq",
                    value: "operator",
                  },
                ],
              },
            ],
            distributions: [
              {
                variantKey: "green",
                rollout: 100,
                variantAttachment: '{"color":"green"}',
              },
            ],
          },
        ],
      },
      {
        ...metadata("boolean"),
        type: "boolean",
        default: false,
        rollouts: [
          {
            segmentKey: "operators",
            segmentOperator: "OR_SEGMENT_OPERATOR",
            matchType: "ALL_SEGMENT_MATCH_TYPE",
            constraints: [
              {
                type: "STRING_CONSTRAINT_COMPARISON_TYPE",
                property: "role",
                operator: "eq",
                value: "operator",
              },
            ],
            result: true,
          },
        ],
        rules: [],
        thresholdRollouts: [{ rank: 0, percentage: 25, result: true }],
      },
    ]);
    const parsed: unknown = YAML.parse(
      renderFliptFeatures("prod", "test", inventory),
    );
    const rendered = RenderedFeaturesSchema.parse(parsed);

    expect(rendered.flags).toContainEqual(
      expect.objectContaining({
        key: "variant",
        rules: [
          expect.objectContaining({
            rank: 0,
            distributions: [{ variant: "green", rollout: 100 }],
          }),
        ],
        variants: expect.arrayContaining([
          expect.objectContaining({
            key: "green",
            attachment: { color: "green" },
          }),
        ]),
      }),
    );
    expect(rendered.flags).toContainEqual(
      expect.objectContaining({
        key: "boolean",
        rollouts: [
          expect.objectContaining({
            threshold: { percentage: 25, value: true },
          }),
          expect.objectContaining({
            segment: expect.objectContaining({ keys: ["operators"] }),
          }),
        ],
      }),
    );
  });

  test("fails on conflicting segment definitions", () => {
    expect(() =>
      testInventory([
        {
          ...metadata("first"),
          type: "boolean",
          default: false,
          ...behavior,
          rollouts: booleanRollouts("first"),
        },
        {
          ...metadata("second"),
          type: "boolean",
          default: false,
          ...behavior,
          rollouts: booleanRollouts("second"),
        },
      ]),
    ).toThrow(/conflicting managed segment definition/);
  });
});
