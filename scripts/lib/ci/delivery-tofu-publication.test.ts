import { afterEach, describe, expect, test } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PublishBuildSchema } from "@shepherdjerred/delivery/contract";
import { SERVICE_CATALOG } from "@shepherdjerred/ops-model/catalog.ts";
import { TofuStackSchema } from "@shepherdjerred/ops-model/platform-policy.ts";
import type { TofuStack } from "@shepherdjerred/ops-model/platform-policy.ts";
import { readTofuArchiveMetadata } from "../../ci/write-tofu-archive-handoff.ts";
import {
  tofuArchiveArtifactId,
  tofuArchiveComponent,
  tofuArchiveServiceId,
  tofuArchiveUri,
} from "../tofu-archive.ts";
import {
  attachTofuArchivePublications,
  parseTofuArchivePublications,
} from "./delivery-tofu-publication.ts";
import { tofuArchiveCatalog } from "./testing/service-catalog.ts";

const digest = `sha256:${"c".repeat(64)}`;
const execution = { repositoryId: 1, pipelineNumber: 42 };
const metadata = {
  ...execution,
  sourceRevision: "a".repeat(40),
  ciUrl: "https://woodpecker.sjer.red/repos/1/pipeline/42",
  capturedAt: "2026-10-17T10:00:00.000Z",
  catalog: tofuArchiveCatalog(),
};
function artifact(stack: TofuStack, overrides: Record<string, unknown> = {}) {
  return {
    id: tofuArchiveArtifactId(1, 42, stack),
    component: tofuArchiveComponent(stack),
    kind: "archive",
    uri: tofuArchiveUri(stack, digest),
    digest,
    version: "build-42",
    ...overrides,
  };
}
function receipt(stack: TofuStack, overrides: Record<string, unknown> = {}) {
  return {
    serviceId: tofuArchiveServiceId(stack),
    artifact: artifact(stack, overrides),
  };
}
const complete = () => TofuStackSchema.options.map((stack) => receipt(stack));
const scratch: string[] = [];
afterEach(async () => {
  await Promise.all(
    scratch.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

describe("OpenTofu archive registration", () => {
  test("registers one pending build per stack service, each owning exactly its archive", () => {
    const existing = PublishBuildSchema.parse({
      requestId: "ci/1/42/arcade",
      serviceId: "arcade",
      sourceRevision: metadata.sourceRevision,
      ciUrl: metadata.ciUrl,
      verifiedAt: metadata.capturedAt,
      artifacts: [],
      retainedArtifactIds: ["original-arcade"],
    });
    const builds = attachTofuArchivePublications(
      [existing],
      complete(),
      metadata,
    );
    expect(builds[0]).toBe(existing);
    expect(builds).toHaveLength(1 + TofuStackSchema.options.length);
    const cloudflare = builds.find(
      (build) => build.serviceId === "tofu-cloudflare",
    );
    expect(cloudflare).toMatchObject({
      requestId: "ci/1/42/tofu-cloudflare",
      sourceRevision: metadata.sourceRevision,
      ciUrl: metadata.ciUrl,
      verifiedAt: metadata.capturedAt,
      retainedArtifactIds: [],
      artifacts: [
        {
          id: "ci/1/42/tofu/cloudflare",
          component: "archive:tofu-cloudflare",
          kind: "archive",
          uri: `s3://delivery-artifacts/tofu/cloudflare/${"c".repeat(64)}.tar`,
          digest,
          version: "build-42",
          requires: {},
          runtimeDigests: [],
          origin: { kind: "first-party" },
        },
      ],
    });
    expect(cloudflare?.platformChanges).toBeUndefined();
    expect(builds.slice(1).map((build) => build.serviceId)).toEqual(
      TofuStackSchema.options.map((stack) => tofuArchiveServiceId(stack)),
    );
  });

  test("a partial, repeated or foreign-owned handoff never registers as a complete run", () => {
    const [first, ...rest] = complete();
    expect(() => parseTofuArchivePublications(rest)).toThrow(
      "missing stacks: application-secrets",
    );
    expect(() => parseTofuArchivePublications([...rest, first, first])).toThrow(
      "repeats stack application-secrets",
    );
    expect(() =>
      parseTofuArchivePublications([
        ...rest,
        { ...first, serviceId: "static-sites" },
      ]),
    ).toThrow("Unknown OpenTofu archive service static-sites");
    expect(() => parseTofuArchivePublications(complete())).not.toThrow();
  });

  test.each([
    ["component", { component: "archive:tofu-github" }],
    ["kind", { kind: "chart" }],
    ["uri", { uri: tofuArchiveUri("github", digest) }],
    ["bytes", { uri: tofuArchiveUri("arr", `sha256:${"d".repeat(64)}`) }],
    ["dependency", { requires: { "image:arcade": digest } }],
    ["runtime digests", { runtimeDigests: [digest] }],
    [
      "origin",
      {
        origin: {
          kind: "upstream",
          repository: "https://example.invalid",
          name: "arr",
          version: "build-42",
          checksum: digest,
        },
      },
    ],
  ])(
    "rejects an archive whose %s is not the stack's own immutable source",
    (_, overrides) => {
      const entries = complete().map((entry) =>
        entry.serviceId === "tofu-arr" ? receipt("arr", overrides) : entry,
      );
      expect(() => parseTofuArchivePublications(entries)).toThrow();
    },
  );

  test("an archive from another CI execution cannot be registered by this one", () => {
    const foreign = complete().map((entry) =>
      entry.serviceId === "tofu-arr"
        ? receipt("arr", { id: tofuArchiveArtifactId(1, 41, "arr") })
        : entry,
    );
    expect(() => parseTofuArchivePublications(foreign)).not.toThrow();
    expect(() => attachTofuArchivePublications([], foreign, metadata)).toThrow(
      "belongs to another CI execution",
    );
    const stale = complete().map((entry) =>
      entry.serviceId === "tofu-arr"
        ? receipt("arr", { version: "build-41" })
        : entry,
    );
    expect(() => attachTofuArchivePublications([], stale, metadata)).toThrow(
      "belongs to another CI execution",
    );
  });

  test("every stack service must exist in the catalog and be published once", () => {
    expect(() =>
      attachTofuArchivePublications([], complete(), {
        ...metadata,
        catalog: SERVICE_CATALOG,
      }),
    ).toThrow("requires a service catalog owner tofu-application-secrets");
    const duplicate = PublishBuildSchema.parse({
      requestId: "ci/1/42/tofu-arr",
      serviceId: "tofu-arr",
      sourceRevision: metadata.sourceRevision,
      ciUrl: metadata.ciUrl,
      verifiedAt: metadata.capturedAt,
      artifacts: [artifact("arr")],
    });
    expect(() =>
      attachTofuArchivePublications([duplicate], complete(), metadata),
    ).toThrow("cannot publish tofu-arr twice");
  });

  test("the handoff writer derives each service from the producer's per-stack record", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "tofu-archive-meta-"));
    scratch.push(directory);
    for (const stack of TofuStackSchema.options)
      await Bun.write(
        path.join(directory, `${stack}.json`),
        `${JSON.stringify(artifact(stack))}\n`,
      );
    const records = await readTofuArchiveMetadata(directory);
    expect(records.map((record) => record.serviceId).sort()).toEqual(
      TofuStackSchema.options
        .map((stack) => tofuArchiveServiceId(stack))
        .sort(),
    );
    expect(
      parseTofuArchivePublications(records, execution).map(
        (entry) => entry.serviceId,
      ),
    ).toEqual(
      TofuStackSchema.options.map((stack) => tofuArchiveServiceId(stack)),
    );
    await Bun.write(path.join(directory, "unknown.json"), "{}\n");
    await expect(readTofuArchiveMetadata(directory)).rejects.toThrow(
      "Unknown OpenTofu stack: unknown",
    );
  });
});
