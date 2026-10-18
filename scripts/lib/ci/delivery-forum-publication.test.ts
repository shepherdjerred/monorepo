import { expect, test } from "vitest";
import { DeliveryClientError } from "@shepherdjerred/delivery/client";
import {
  ArtifactVersionSchema,
  PublishBuildSchema,
} from "@shepherdjerred/delivery/contract";
import {
  SERVICE_CATALOG,
  parseCatalog,
} from "@shepherdjerred/ops-model/catalog.ts";
import { forumBundlePolicy } from "@shepherdjerred/ops-model/forum-bundle-policy.ts";
import { forumBundlePolicyDigest } from "@shepherdjerred/ops-model/forum-bundle-digest.ts";
import { attachForumPublication } from "./delivery-forum-publication.ts";

const original = ArtifactVersionSchema.parse({
  id: "licensed/original",
  serviceId: "storm-forum",
  buildId: "licensed/independent-acquisition",
  component: "archive:forum-bundle",
  kind: "archive",
  uri: `s3://storm-forum-releases/releases/${"b".repeat(64)}.zip`,
  digest: `sha256:${"b".repeat(64)}`,
  version: forumBundlePolicy.xenforoVersion,
  sourceRevision: "a".repeat(40),
  createdAt: "2026-10-17T10:00:00.000Z",
  origin: {
    kind: "licensed-bundle",
    manifestDigest: forumBundlePolicyDigest(),
    xenforoVersion: forumBundlePolicy.xenforoVersion,
    producerSourceRevision: "a".repeat(40),
  },
});
const producer = PublishBuildSchema.parse({
  requestId: "ci/1/42/storm-forum",
  serviceId: "storm-forum",
  sourceRevision: "c".repeat(40),
  ciUrl: "https://woodpecker.sjer.red/repos/1/pipeline/42",
  verifiedAt: "2026-10-17T11:00:00.000Z",
  artifacts: [
    {
      id: "ci/1/42/image/storm-forum",
      component: "image:storm-forum",
      kind: "image",
      uri: "docker.io/shepherdjerred/storm-forum",
      digest: `sha256:${"d".repeat(64)}`,
      version: "2.0.0-1000042",
    },
  ],
});
const delegated = parseCatalog({
  ...SERVICE_CATALOG,
  deliveryDelegations: { "storm-forum": "storm-forum/prod" },
});
const missing = async () => {
  throw new DeliveryClientError(404, "NOT_FOUND", "No qualified bundle");
};

test("a genuine CI producer retains original licensed identity without relabeling bytes or its source", async () => {
  const [publication] = await attachForumPublication(
    [producer],
    async (query) => {
      expect(query).toEqual({
        xenforoVersion: forumBundlePolicy.xenforoVersion,
        manifestDigest: forumBundlePolicyDigest(),
      });
      return original;
    },
    delegated,
  );
  expect(publication?.artifacts).toEqual(producer.artifacts);
  expect(publication?.retainedArtifactIds).toEqual([original.id]);
  expect(publication?.sourceRevision).toBe(producer.sourceRevision);
  expect(original.sourceRevision).not.toBe(producer.sourceRevision);
  expect(producer.retainedArtifactIds).toEqual([]);
  expect(
    await attachForumPublication(
      [PublishBuildSchema.parse(publication)],
      async () => original,
      delegated,
    ),
  ).toEqual([publication]);
});

test("unrelated and retained-only publications do not manufacture a new forum CI producer", async () => {
  const retainedOnly = {
    ...producer,
    artifacts: [],
    retainedArtifactIds: [original.id],
  };
  expect(await attachForumPublication([], missing, delegated)).toEqual([]);
  expect(
    await attachForumPublication([retainedOnly], missing, delegated),
  ).toEqual([retainedOnly]);
});

test("an unprovisioned legacy-owned bundle is optional, but source delegation makes it required", async () => {
  expect(await attachForumPublication([producer], missing)).toEqual([producer]);
  await expect(
    attachForumPublication([producer], missing, delegated),
  ).rejects.toMatchObject({ status: 404 });
  await expect(
    attachForumPublication([producer], async () => {
      throw new DeliveryClientError(503, "UNAVAILABLE", "Catalog unavailable");
    }),
  ).rejects.toMatchObject({ status: 503 });
});

test.each([
  { origin: { kind: "first-party" } },
  { version: "1.0.0" },
  { serviceId: "arcade" },
  { sourceRevision: "f".repeat(40) },
  { uri: `s3://storm-forum-releases/releases/${"e".repeat(64)}.zip` },
  {
    origin: { ...original.origin, manifestDigest: `sha256:${"e".repeat(64)}` },
  },
])(
  "policy and original-byte identity are checked even before cutover: %j",
  async (change) => {
    await expect(
      attachForumPublication([producer], async () => ({
        ...original,
        ...change,
      })),
    ).rejects.toThrow();
  },
);
