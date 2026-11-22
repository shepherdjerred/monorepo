import { expect, test } from "vitest";
import { FliptSnapshotSchema } from "@shepherdjerred/feature-flags/managed-flag-drift.ts";
import {
  importDeploymentDocuments,
  projectSnapshotDocument,
} from "./import-flipt.ts";
import { FlagStore } from "./store.ts";

const booleanFlag = {
  key: "dares_enabled",
  enabled: false,
  type: "BOOLEAN_FLAG_TYPE",
  rules: [],
  rollouts: [
    {
      type: "SEGMENT_ROLLOUT_TYPE",
      rank: 0,
      segment: {
        value: true,
        segmentOperator: "OR_SEGMENT_OPERATOR",
        segments: [
          {
            key: "prod",
            matchType: "ALL_SEGMENT_MATCH_TYPE",
            constraints: [
              {
                type: "STRING_CONSTRAINT_COMPARISON_TYPE",
                property: "stage",
                operator: "eq",
                value: "prod",
              },
            ],
          },
        ],
      },
    },
  ],
};

test("projects a boolean segment and a variant string", () => {
  const snapshot = FliptSnapshotSchema.parse({
    flags: [
      booleanFlag,
      {
        key: "scout-explore-model",
        enabled: true,
        type: "VARIANT_FLAG_TYPE",
        rules: [],
        rollouts: [],
        defaultVariant: { key: "gpt-5.6-luna" },
      },
    ],
  });
  expect(projectSnapshotDocument(snapshot)).toEqual([
    {
      type: "boolean",
      key: "dares_enabled",
      default: false,
      rollouts: [
        {
          result: true,
          constraints: [{ property: "stage", value: "prod" }],
        },
      ],
    },
    {
      type: "variant",
      key: "scout-explore-model",
      value: "gpt-5.6-luna",
    },
  ]);
});

test("refuses a percentage rollout", () => {
  const snapshot = FliptSnapshotSchema.parse({
    flags: [
      {
        key: "ramped",
        enabled: true,
        type: "BOOLEAN_FLAG_TYPE",
        rules: [],
        rollouts: [
          {
            type: "THRESHOLD_ROLLOUT_TYPE",
            rank: 0,
            threshold: { percentage: 30, value: true },
          },
        ],
      },
    ],
  });
  expect(() => projectSnapshotDocument(snapshot)).toThrow(/percentage rollout/);
});

const liveModel = () =>
  Promise.resolve(
    Response.json({
      flags: [
        {
          key: "scout-explore-model",
          enabled: true,
          type: "VARIANT_FLAG_TYPE",
          rules: [],
          rollouts: [],
          defaultVariant: { key: "gpt-5.6-luna" },
        },
      ],
    }),
  );

test("imports one document per deployment and does not replace it", async () => {
  const documents = await importDeploymentDocuments(
    "https://flipt.example.test",
    liveModel,
    [
      {
        id: "scout/prod",
        catalog: "scout",
        stage: "prod",
        fliptEnvironment: "prod",
      },
    ],
  );
  const store = FlagStore.open(":memory:");
  expect(store.seedDocuments(documents).seeded).toEqual(["scout/prod"]);
  store.seedDocuments([
    {
      id: "scout/prod",
      flags: [
        {
          type: "variant",
          key: "scout-explore-model",
          value: "gpt-6-luna",
        },
      ],
    },
  ]);
  expect(store.flag("scout/prod", "scout-explore-model")?.flag).toEqual({
    type: "variant",
    key: "scout-explore-model",
    value: "gpt-5.6-luna",
  });
});
