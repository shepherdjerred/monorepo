import { describe, expect, test } from "vitest";
import { ManagedFlagInventorySchema } from "./managed-flag-inventory.ts";
import {
  collectManagedSegmentPayloads,
  toFliptFlagPayload,
} from "./flipt-resource-payloads.ts";

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

function testFlags() {
  return ManagedFlagInventorySchema.parse({
    version: 3,
    namespaces: [{ key: "test", name: "Test", description: "Test namespace." }],
    environments: [
      { key: "beta", overrides: [] },
      { key: "prod", overrides: [] },
    ],
    flags: [
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
        thresholdRollouts: [{ rank: 1, percentage: 25, result: true }],
      },
      {
        ...metadata("variant"),
        type: "variant",
        default: "blue",
        ...behavior,
        rules: [
          {
            rank: 1,
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
    ],
    exemptions: [],
  }).flags;
}

describe("Flipt resource payloads", () => {
  test("accepts Flipt one-based rank for a lone threshold rollout", () => {
    const inventory = ManagedFlagInventorySchema.parse({
      version: 3,
      namespaces: [
        { key: "test", name: "Test", description: "Test namespace." },
      ],
      environments: [
        { key: "beta", overrides: [] },
        { key: "prod", overrides: [] },
      ],
      flags: [
        {
          ...metadata("ramp"),
          type: "boolean",
          default: false,
          rollouts: [],
          rules: [],
          thresholdRollouts: [{ rank: 1, percentage: 30, result: true }],
        },
      ],
      exemptions: [],
    });
    const flag = inventory.flags[0];
    if (flag === undefined) throw new Error("ramp fixture is missing");
    expect(toFliptFlagPayload(flag).rollouts).toEqual([
      {
        type: "THRESHOLD_ROLLOUT_TYPE",
        description: "Managed threshold rollout at rank 1.",
        threshold: { percentage: 30, value: true },
      },
    ]);
  });

  test("builds boolean rollouts with threshold ranks and API segment keys", () => {
    const flag = testFlags().find((candidate) => candidate.key === "boolean");
    if (flag === undefined) throw new Error("boolean fixture is missing");
    expect(toFliptFlagPayload(flag)).toMatchObject({
      "@type": "flipt.core.Flag",
      key: "boolean",
      type: "BOOLEAN_FLAG_TYPE",
      enabled: false,
      rollouts: [
        {
          type: "THRESHOLD_ROLLOUT_TYPE",
          threshold: { percentage: 25, value: true },
        },
        {
          type: "SEGMENT_ROLLOUT_TYPE",
          segment: {
            value: true,
            segments: ["operators"],
            segmentOperator: "OR_SEGMENT_OPERATOR",
          },
        },
      ],
    });
  });

  test("builds variant flags with defaultVariant and parsed attachments", () => {
    const flag = testFlags().find((candidate) => candidate.key === "variant");
    if (flag === undefined) throw new Error("variant fixture is missing");
    expect(toFliptFlagPayload(flag)).toMatchObject({
      "@type": "flipt.core.Flag",
      type: "VARIANT_FLAG_TYPE",
      enabled: true,
      defaultVariant: "blue",
      variants: [
        { key: "blue", attachment: {} },
        { key: "green", attachment: { color: "green" } },
      ],
      rules: [
        {
          rank: 1,
          segmentOperator: "OR_SEGMENT_OPERATOR",
          segments: ["operators"],
          distributions: [{ variant: "green", rollout: 100 }],
        },
      ],
    });
  });

  test("normalizes a JSON null variant attachment to an empty object", () => {
    const inventory = ManagedFlagInventorySchema.parse({
      version: 3,
      namespaces: [
        { key: "test", name: "Test", description: "Test namespace." },
      ],
      environments: [
        { key: "beta", overrides: [] },
        { key: "prod", overrides: [] },
      ],
      flags: [
        {
          ...metadata("model"),
          type: "variant",
          default: "sol",
          rollouts: [],
          thresholdRollouts: [],
          rules: [
            {
              rank: 1,
              segmentOperator: "OR_SEGMENT_OPERATOR",
              segments: [
                {
                  key: "everyone",
                  matchType: "ALL_SEGMENT_MATCH_TYPE",
                  constraints: [],
                },
              ],
              distributions: [
                {
                  variantKey: "sol",
                  rollout: 100,
                  variantAttachment: "null",
                },
              ],
            },
          ],
        },
      ],
      exemptions: [],
    });
    const flag = inventory.flags[0];
    if (flag === undefined) throw new Error("model fixture is missing");
    expect(toFliptFlagPayload(flag).variants).toEqual([
      { key: "sol", name: "sol", description: "", attachment: {} },
    ]);
  });

  test("rejects a zero-based variant rule rank", () => {
    const inventory = ManagedFlagInventorySchema.parse({
      version: 3,
      namespaces: [
        { key: "test", name: "Test", description: "Test namespace." },
      ],
      environments: [
        { key: "beta", overrides: [] },
        { key: "prod", overrides: [] },
      ],
      flags: [
        {
          ...metadata("model"),
          type: "variant",
          default: "sol",
          rollouts: [],
          thresholdRollouts: [],
          rules: [
            {
              rank: 0,
              segmentOperator: "OR_SEGMENT_OPERATOR",
              segments: [
                {
                  key: "everyone",
                  matchType: "ALL_SEGMENT_MATCH_TYPE",
                  constraints: [],
                },
              ],
              distributions: [
                {
                  variantKey: "sol",
                  rollout: 100,
                  variantAttachment: "{}",
                },
              ],
            },
          ],
        },
      ],
      exemptions: [],
    });
    const flag = inventory.flags[0];
    if (flag === undefined) throw new Error("model fixture is missing");
    expect(() => toFliptFlagPayload(flag)).toThrow(
      "variant rule rank must be contiguous and one-based for model: expected 1, got 0",
    );
  });

  test("collects unique segments with Flipt comparison enums", () => {
    expect(collectManagedSegmentPayloads(testFlags())).toEqual([
      {
        "@type": "flipt.core.Segment",
        key: "operators",
        name: "operators",
        description: "Managed segment operators.",
        matchType: "ALL_MATCH_TYPE",
        constraints: [
          {
            type: "STRING_COMPARISON_TYPE",
            property: "role",
            operator: "eq",
            value: "operator",
            description: "Match role.",
          },
        ],
      },
    ]);
  });
});
