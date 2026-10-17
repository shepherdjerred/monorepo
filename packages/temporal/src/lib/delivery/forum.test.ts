import { describe, expect, test } from "vitest";
import {
  PipelineRevisionSchema,
  VersionSetRevisionSchema,
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
        uri: `s3://storm-forum-releases/releases/${digit}.zip`,
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
  test("selects candidate bytes while backing up the frozen previously accepted runtime", () => {
    const detail = fixture();
    const result = forumReleaseParameters(detail);
    expect(result["delivery.image"]).toBe(
      `docker.io/shepherdjerred/storm-forum@sha256:${"b".repeat(64)}`,
    );
    expect(result["delivery.bundleKey"]).toBe("releases/b.zip");
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
    ).toThrow("verified accepted baseline");
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
