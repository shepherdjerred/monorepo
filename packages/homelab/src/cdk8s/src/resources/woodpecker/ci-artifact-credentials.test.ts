import { App, Chart, Testing } from "cdk8s";
import { expect, test } from "vitest";
import { z } from "zod";
import { DELIVERY_STORAGE_ITEMS } from "homelab/src/delivery-storage.ts";
import { DELIVERY_PLATFORM_ITEMS } from "homelab/src/delivery-platform-grants.ts";
import snapshot from "@shepherdjerred/homelab/cdk8s/onepassword-vault-snapshot.json" with { type: "json" };
import {
  hash,
  SnapshotSchema,
} from "@shepherdjerred/homelab/cdk8s/scripts/onepassword-lib.ts";
import { createWoodpeckerCredentialBoundaries } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/ci/woodpecker-credentials.ts";

test("CI mirrors minimal publication/handoff items and retains no deployment provider or runtime identity", () => {
  const chart = new Chart(new App(), "ci-build-credentials");
  createWoodpeckerCredentialBoundaries(chart);
  const resources = Testing.synth(chart);
  expect(resources).toContainEqual(
    expect.objectContaining({
      kind: "OnePasswordItem",
      metadata: expect.objectContaining({
        name: "woodpecker-extension-github-credentials",
        namespace: "woodpecker",
      }),
      spec: {
        itemPath:
          "vaults/v64ocnykdqju4ui6j6pua56xw4/items/3kwpfoyzu6a7icnm7jg7dn7scy",
      },
    }),
  );
  expect(DELIVERY_PLATFORM_ITEMS["ci-github-credentials"]).toEqual({
    itemId: "34gzcrhwdm34lpadyly3rcsu44",
  });
  const ItemSchema = z.object({
    kind: z.literal("OnePasswordItem"),
    metadata: z.object({
      name: z.string(),
      namespace: z.literal("woodpecker-ci"),
    }),
    spec: z.object({ itemPath: z.string() }),
  });
  const items = resources.flatMap((resource) => {
    const parsed = ItemSchema.safeParse(resource);
    return parsed.success ? [parsed.data] : [];
  });
  const minimal = {
    "ci-github-credentials": {
      id: "3kwpfoyzu6a7icnm7jg7dn7scy",
      fields: [
        "GITHUB_APP_ID",
        "GITHUB_APP_INSTALLATION_ID",
        "GITHUB_APP_PRIVATE_KEY",
        "GITHUB_DOWNLOAD_TOKEN",
        "GITHUB_PACKAGES_TOKEN",
        "GITHUB_REVIEW_TOKEN",
      ],
    },
    "ci-delivery-credentials": {
      id: "mrvxxnlx3rk6dlfmkxgdfqio5e",
      fields: ["DELIVERY_PUBLISHER_TOKEN"],
    },
    "ci-seaweedfs-credentials": {
      id: "quqpki5jgjf4pc5lotdbxxkep4",
      fields: [
        "SEAWEEDFS_HANDOFF_ACCESS_KEY_ID",
        "SEAWEEDFS_HANDOFF_SECRET_ACCESS_KEY",
      ],
    },
  };
  const vault = SnapshotSchema.parse(snapshot);
  expect(
    items.find(
      (item) => item.metadata.name === "ci-delivery-archive-credentials",
    )?.spec.itemPath,
  ).toContain(`/items/${DELIVERY_STORAGE_ITEMS.publisher}`);
  for (const [name, expected] of Object.entries(minimal)) {
    expect(
      items.find((item) => item.metadata.name === name)?.spec.itemPath,
    ).toContain(`/items/${expected.id}`);
    const item = vault.items.find((entry) => entry.ref === hash(expected.id));
    expect(item?.blankFields).toEqual([hash("notesPlain")]);
    expect(
      item?.fields.filter((field) => field !== hash("notesPlain")).toSorted(),
    ).toEqual(expected.fields.map((field) => hash(field)).toSorted());
  }
  expect(items.map((item) => item.metadata.name).toSorted()).toEqual(
    [
      "ci-delivery-archive-credentials",
      "ci-delivery-credentials",
      "ci-seaweedfs-credentials",
      "dockerhub-pull-woodpecker-ci",
      "ci-dockerhub-publisher-credentials",
      "ci-github-credentials",
      "ci-turbo-cache-credentials",
      "ci-npm-credentials",
      "ci-release-openai-credentials",
      "ci-chartmuseum-credentials",
    ].toSorted(),
  );
});
