import { describe, expect, it } from "vitest";
import {
  tofuJobInput,
  tofuJobInputFor,
  tofuJobRequestInput,
  tofuStackDirectory,
  tofuStateMarkerKey,
  writeTofuStateMarker,
  type MarkerStore,
} from "./tofu-input.ts";

const snapshot = {
  kind: "tofu-plan" as const,
  stack: "github" as const,
  source: {
    id: "build/5",
    sourceRevision: "e".repeat(40),
    repositoryId: 1,
    pipelineNumber: 5,
    ciUrl: "https://woodpecker.sjer.red/repos/1/pipeline/5",
  },
  prerequisites: [],
  policyFingerprint: "f".repeat(64),
};
const archive = {
  uri: "s3://delivery-artifacts/stacks/github/abc.tar",
  digest: `sha256:${"1".repeat(64)}`,
};
const artifact = {
  id: "archive/github",
  component: "archive:tofu-github",
  kind: "archive" as const,
  uri: archive.uri,
  digest: archive.digest,
  runtimeDigests: [],
  requires: {},
  version: "5",
  origin: { kind: "first-party" as const },
  serviceId: "tofu-github",
  buildId: "build/5",
  sourceRevision: "e".repeat(40),
  createdAt: "2026-10-20T00:00:00.000Z",
};

describe("Tofu Job input", () => {
  it("accepts the bare snapshot and the archive wrapper, nothing else", () => {
    expect(tofuJobInput(snapshot)).toEqual({ snapshot, archive: undefined });
    expect(tofuJobInput({ snapshot, archive })).toEqual({ snapshot, archive });
    expect(() => tofuJobInput({ snapshot })).toThrow();
    expect(() => tofuJobInput({ ...snapshot, archive })).toThrow();
    expect(() =>
      tofuJobInput({ snapshot, archive: { ...archive, uri: "s3://other/x" } }),
    ).toThrow();
    expect(() =>
      tofuJobInput({
        snapshot: { ...snapshot, kind: "root-release", charts: [] },
      }),
    ).toThrow();
  });
  it("wraps the snapshot with the set revision's stack archive when present", () => {
    const detail = {
      versionSet: {
        id: "set/1",
        serviceId: "tofu-github",
        revision: 1,
        baseRevisionId: null,
        lineage: "c".repeat(64),
        orderKey: null,
        components: { "archive:tofu-github": artifact },
        createdAt: "2026-10-20T00:00:00.000Z",
      },
    };
    const input = tofuJobInputFor(detail, snapshot);
    expect(input).toEqual({ snapshot, archive });
    expect(tofuJobRequestInput(input)).toEqual({ snapshot, archive });
    const bare = tofuJobInputFor(
      { versionSet: { ...detail.versionSet, components: {} } },
      snapshot,
    );
    expect(tofuJobRequestInput(bare)).toEqual(snapshot);
    expect(() =>
      tofuJobInputFor(
        {
          versionSet: {
            ...detail.versionSet,
            components: {
              "archive:tofu-github": { ...artifact, kind: "chart" as const },
            },
          },
        },
        snapshot,
      ),
    ).toThrow("not an archive artifact");
  });
  it("resolves the extracted directory only in archive mode", () => {
    expect(
      tofuStackDirectory({ snapshot, archive: undefined }, {}),
    ).toBeUndefined();
    expect(
      tofuStackDirectory(
        { snapshot, archive },
        { DELIVERY_STACK_ARCHIVE_DIR: "/workspace/stack" },
      ),
    ).toBe("/workspace/stack");
    expect(() => tofuStackDirectory({ snapshot, archive }, {})).toThrow(
      "missing its extracted stack directory",
    );
  });
});

function store(readback?: (body: string) => string): MarkerStore & {
  objects: Map<string, string>;
} {
  const objects = new Map<string, string>();
  return {
    objects,
    write: async (key, body) => {
      objects.set(key, body);
    },
    read: async (key) => {
      const body = objects.get(key);
      if (body === undefined) throw new Error("missing");
      return readback === undefined ? body : readback(body);
    },
  };
}

describe("Tofu state marker", () => {
  const marker = {
    schema: "delivery-tofu-marker/v1" as const,
    deploymentId: "deployment/apply",
    stack: "github",
    stateLineage: "lineage-1",
    stateSerial: 7,
    archiveDigest: archive.digest,
    appliedAt: "2026-10-20T00:00:00.000Z",
  };
  it("writes the marker next to the state and reads it back byte-for-byte", async () => {
    const objects = store();
    await writeTofuStateMarker(objects, marker);
    expect(tofuStateMarkerKey("github")).toBe("github/delivery-marker.json");
    expect(
      JSON.parse(objects.objects.get("github/delivery-marker.json")!),
    ).toEqual(marker);
  });
  it("fails the apply when the readback differs", async () => {
    await expect(
      writeTofuStateMarker(
        store((body) => body.replace("deployment/apply", "other")),
        marker,
      ),
    ).rejects.toThrow("readback differs");
  });
});
