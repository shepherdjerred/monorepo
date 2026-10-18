import { expect, test } from "vitest";
import { readPublicationHandoffs } from "./delivery-publication-handoffs.ts";
import { buildPublications } from "../../ci/publish-delivery.ts";

const artifact = {
  id: "ci/1/42/trmnl-plugins",
  kind: "archive",
  component: "archive:trmnl-plugins",
  uri: `s3://delivery-artifacts/trmnl-plugins/${"a".repeat(64)}.json`,
  digest: `sha256:${"a".repeat(64)}`,
  version: "2.0.0-1000042",
  requires: { "image:trmnl-dashboard": `sha256:${"b".repeat(64)}` },
};
const publication = { serviceId: "trmnl-dashboard", artifact };
function handoffs(trmnl: unknown) {
  return {
    optional: () => Promise.resolve(undefined),
    required: (key: string) =>
      Promise.resolve(
        key === "delivery-image-digests"
          ? "{}"
          : key === "trmnl-plugin-artifacts"
            ? JSON.stringify(trmnl)
            : "[]",
      ),
  };
}

test("TRMNL provenance handoff is required even when no static-site archives are selected", async () => {
  await expect(
    readPublicationHandoffs(false, {
      optional: () => Promise.resolve(undefined),
      required: (key) => {
        if (key === "delivery-image-digests") return Promise.resolve("{}");
        if (key === "delivery-retained-image-artifacts")
          return Promise.resolve("[]");
        throw new Error(`Missing required ${key}`);
      },
    }),
  ).rejects.toThrow("Missing required trmnl-plugin-artifacts");
  const empty = await readPublicationHandoffs(false, handoffs([]));
  expect(empty.siteArtifacts).toEqual([]);
});

test.each([false, true])(
  "TRMNL archive preserves its original producer and exact backend dependency (static=%s)",
  async (staticArchives) => {
    const input = await readPublicationHandoffs(
      staticArchives,
      handoffs([publication]),
    );
    const builds = await buildPublications(
      {
        ...input,
        sourceRevision: "c".repeat(40),
        ciUrl: "https://woodpecker.sjer.red/repos/1/pipeline/42",
        pipelineNumber: 42,
        repositoryId: 1,
        capturedAt: "2026-10-17T10:00:00.000Z",
      },
      {
        inspectImage: () => {
          throw new Error("No image was produced");
        },
        chartArtifact: () => {
          throw new Error("No chart was produced");
        },
      },
    );
    expect(builds).toHaveLength(1);
    expect(builds[0]?.serviceId).toBe("trmnl-dashboard");
    expect(builds[0]?.artifacts[0]).toMatchObject(artifact);
  },
);

test.each([
  { ...publication, serviceId: "static-sites" },
  { ...publication, artifact: { ...artifact, component: "archive:other" } },
  { ...publication, artifact: { ...artifact, requires: {} } },
  {
    ...publication,
    artifact: {
      ...artifact,
      uri: `s3://delivery-artifacts/trmnl-plugins/${"d".repeat(64)}.json`,
    },
  },
])(
  "TRMNL handoff rejects another owner, component, bytes, or missing backend: %j",
  async (invalid) => {
    await expect(
      readPublicationHandoffs(false, handoffs([invalid])),
    ).rejects.toThrow();
  },
);
