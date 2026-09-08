import { describe, expect, test } from "vitest";

import {
  declaredSecretItems,
  hash,
  parseSecretGrantManifest,
  validateGrantCatalog,
  type SecretGrantManifest,
} from "./ci-secret-grant-schema.ts";

const ITEM_ID = "item-id";
const DECLARATION = `
new OnePasswordItem(chart, "buildkite-test-credentials", {
  spec: { itemPath: "vaults/vault/items/${ITEM_ID}" },
});`;

function manifest(key = "TOKEN"): SecretGrantManifest {
  return parseSecretGrantManifest({
    secrets: { "buildkite-test-credentials": { itemId: ITEM_ID } },
    pipelines: {
      ".buildkite/pipeline.yml": {
        "test-step": [
          {
            env: "TOKEN",
            secret: "buildkite-test-credentials",
            key,
          },
        ],
      },
    },
  });
}

function snapshot(blankFields: string[] = []) {
  return {
    vaultId: "vault",
    generatedAt: "now",
    items: [
      {
        ref: hash(ITEM_ID),
        title: hash("title"),
        fields: [hash("TOKEN")],
        blankFields,
      },
    ],
  };
}

describe("Buildkite grant catalog", () => {
  test("reads cdk8s Secret-to-item declarations", () => {
    expect(declaredSecretItems(DECLARATION)).toEqual(
      new Map([["buildkite-test-credentials", ITEM_ID]]),
    );
  });

  test("rejects blank manifest fields", () => {
    expect(() =>
      parseSecretGrantManifest({
        secrets: { secret: { itemId: ITEM_ID } },
        pipelines: {
          pipeline: {
            step: [{ env: "", secret: "secret", key: "TOKEN" }],
          },
        },
      }),
    ).toThrow();
  });

  test("rejects an unknown Secret", () => {
    expect(() =>
      parseSecretGrantManifest({
        secrets: { known: { itemId: ITEM_ID } },
        pipelines: {
          pipeline: {
            step: [{ env: "TOKEN", secret: "unknown", key: "TOKEN" }],
          },
        },
      }),
    ).toThrow("unknown Secret unknown");
  });

  test("rejects unknown and blank snapshot fields", () => {
    expect(
      validateGrantCatalog({
        manifest: manifest("UNKNOWN"),
        declarationSource: DECLARATION,
        snapshot: snapshot(),
      }),
    ).toContain("Secret buildkite-test-credentials has unknown field UNKNOWN");

    expect(
      validateGrantCatalog({
        manifest: manifest(),
        declarationSource: DECLARATION,
        snapshot: snapshot([hash("TOKEN")]),
      }),
    ).toContain("Secret buildkite-test-credentials field TOKEN is blank");
  });
});
