import { describe, expect, test } from "vitest";
import {
  PipelineRevisionSchema,
  VersionSetRevisionSchema,
  ForumBaselineSnapshotSchema,
} from "@shepherdjerred/delivery/contract";
import { forumReleaseParameters } from "./forum.ts";

const createdAt = "2026-10-16T00:00:00.000Z";
function version(digit: string) {
  const common = {
    serviceId: "storm-forum",
    buildId: `build/${digit}`,
    sourceRevision: digit.repeat(40),
    createdAt,
    version: "1.0.0",
    digest: `sha256:${digit.repeat(64)}`,
  };
  return VersionSetRevisionSchema.parse({
    id: `set/${digit}`,
    serviceId: "storm-forum",
    revision: 1,
    baseRevisionId: null,
    createdAt,
    components: {
      image: {
        ...common,
        id: `image/${digit}`,
        component: "image",
        kind: "image",
        uri: "docker.io/shepherdjerred/storm-forum",
      },
      bundle: {
        ...common,
        id: `bundle/${digit}`,
        component: "bundle",
        kind: "archive",
        uri: `s3://storm-forum-releases/releases/${digit.repeat(64)}.zip`,
        version: digit === "a" ? "2.3.12" : "2.3.13",
        origin: {
          kind: "licensed-bundle",
          manifestDigest: `sha256:${"f".repeat(64)}`,
          xenforoVersion: digit === "a" ? "2.3.12" : "2.3.13",
          producerSourceRevision: digit.repeat(40),
        },
      },
    },
  });
}
function fixture() {
  return {
    pipeline: PipelineRevisionSchema.parse({
      id: "forum/1",
      createdAt,
      definition: {
        kind: "argocd",
        application: "storm-forum",
        chartName: "storm-forum",
        chartRepository: "https://chartmuseum.tailnet-1a49.ts.net",
        chartComponent: "chart:storm-forum",
        artifactParameters: { "delivery.image": "image" },
        parameters: {},
        forumRelease: { imageComponent: "image", bundleComponent: "bundle" },
      },
    }),
    deployment: {
      id: "deployment/1",
      serviceId: "storm-forum",
      configuration: { "forum.xenforoVersion": "2.3.13" },
      previousAcceptedConfiguration: { "forum.xenforoVersion": "2.3.12" },
    },
    versionSet: version("b"),
    previousAcceptedVersionSet: version("a"),
  };
}
describe("forum immutable release selection", () => {
  test("first upgrade uses the frozen independently observed original instead of inventing an accepted version set", () => {
    const detail = fixture(),
      original = detail.previousAcceptedVersionSet;
    const baseline = ForumBaselineSnapshotSchema.parse({
      intentId: "baseline/original",
      image: original.components["image"],
      bundle: original.components["bundle"],
      proof: {
        environmentId: "storm-forum/prod",
        observedAt: createdAt,
        application: {
          name: "storm-forum",
          uid: "app",
          resourceVersion: "1",
          sourceFingerprint: "a".repeat(64),
        },
        runtimeImage: `docker.io/shepherdjerred/storm-forum@sha256:${"a".repeat(64)}`,
        imageArtifactId: "image/a",
        bundleArtifactId: "bundle/a",
        bundleDigest: `sha256:${"a".repeat(64)}`,
        runtime: {
          schemaVersion: 1,
          state: "installed",
          xenforoVersion: "2.3.12",
          bundleSha256: "a".repeat(64),
          maintenance: false,
          releaseLock: false,
        },
        pods: [
          {
            name: "pod",
            uid: "pod-uid",
            resourceVersion: "2",
            imageId: `docker.io/shepherdjerred/storm-forum@sha256:${"a".repeat(64)}`,
            workloadUid: "web-uid",
          },
        ],
        releaseJob: {
          name: "storm-forum-release-a",
          uid: "job-uid",
          resourceVersion: "3",
          specFingerprint: "a".repeat(64),
          completedAt: createdAt,
        },
      },
    });
    const result = forumReleaseParameters({
      ...detail,
      previousAcceptedVersionSet: null,
      deployment: {
        ...detail.deployment,
        previousAcceptedConfiguration: null,
        forumBaselineSnapshot: baseline,
      },
    });
    expect(result["delivery.previousXenforoVersion"]).toBe("2.3.12");
    expect(result["delivery.previousBundleSha256"]).toBe("a".repeat(64));
    expect(result["delivery.image"]).toContain("b".repeat(64));
    expect(() =>
      forumReleaseParameters({
        ...detail,
        deployment: { ...detail.deployment, kind: "rollback" },
      }),
    ).toThrow(/restoration procedure/u);
  });
  test("selects candidate bytes while backing up the frozen previously accepted runtime", () => {
    const detail = fixture();
    const result = forumReleaseParameters(detail);
    expect(result["delivery.image"]).toBe(
      `docker.io/shepherdjerred/storm-forum@sha256:${"b".repeat(64)}`,
    );
    expect(result["delivery.bundleKey"]).toBe(`releases/${"b".repeat(64)}.zip`);
    expect(result["delivery.previousRuntimeImage"]).toBe(
      `docker.io/shepherdjerred/storm-forum@sha256:${"a".repeat(64)}`,
    );
    expect(result["delivery.previousBundleSha256"]).toBe("a".repeat(64));
    expect(result["delivery.previousXenforoVersion"]).toBe("2.3.12");
    expect(forumReleaseParameters(detail)["delivery.releaseId"]).toBe(
      result["delivery.releaseId"],
    );
    expect(
      forumReleaseParameters({
        ...detail,
        deployment: { ...detail.deployment, id: "retry/2" },
      })["delivery.releaseId"],
    ).not.toBe(result["delivery.releaseId"]);
  });
  test("blocks upgrades without a verified baseline, runtime proof binding, or licensed bundle", () => {
    const detail = fixture();
    expect(() =>
      forumReleaseParameters({ ...detail, previousAcceptedVersionSet: null }),
    ).toThrow("verified accepted baseline");
    expect(() =>
      forumReleaseParameters({
        ...detail,
        deployment: {
          ...detail.deployment,
          previousAcceptedConfiguration: null,
        },
      }),
    ).toThrow("accepted XenForo version");
    expect(() =>
      forumReleaseParameters({
        ...detail,
        versionSet: { ...detail.versionSet, components: {} },
      }),
    ).toThrow("licensed bundle");
    expect(() =>
      forumReleaseParameters({
        ...detail,
        deployment: { ...detail.deployment, configuration: {} },
      }),
    ).toThrow("explicit selected XenForo");
  });
});
