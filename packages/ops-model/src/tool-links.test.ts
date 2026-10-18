import { describe, expect, it } from "vitest";
import {
  argocdApplicationLink,
  chartmuseumChartLink,
  dockerHubTagLink,
  githubCommitLink,
  temporalWorkflowLink,
  woodpeckerPipelineLink,
  woodpeckerStepLink,
} from "./tool-links.ts";
import { LinkSchema } from "./snapshot.ts";

describe("tool links", () => {
  it("builds Woodpecker pipeline and step URLs", () => {
    expect(woodpeckerPipelineLink(4210).url).toBe(
      "https://woodpecker.sjer.red/repos/1/pipeline/4210",
    );
    expect(woodpeckerStepLink(4210, { pid: 7, name: "verify" }).url).toBe(
      "https://woodpecker.sjer.red/repos/1/pipeline/4210/7",
    );
  });

  it("encodes workflow identities that contain slashes", () => {
    expect(temporalWorkflowLink("delivery/abc").url).toBe(
      "https://temporal-ui.tailnet-1a49.ts.net/namespaces/prod/workflows/delivery%2Fabc",
    );
  });

  it("links Docker Hub tags and ignores other registries", () => {
    expect(
      dockerHubTagLink(
        `docker.io/shepherdjerred/arcade:1.2.3@sha256:${"a".repeat(64)}`,
      )?.url,
    ).toBe("https://hub.docker.com/r/shepherdjerred/arcade/tags?name=1.2.3");
    expect(dockerHubTagLink("docker.io/shepherdjerred/arcade")?.url).toBe(
      "https://hub.docker.com/r/shepherdjerred/arcade/tags",
    );
    expect(dockerHubTagLink("ghcr.io/owner/image:1")).toBeNull();
    expect(dockerHubTagLink("s3://bucket/key.zip")).toBeNull();
  });

  it("produces schema-valid links", () => {
    for (const link of [
      githubCommitLink("a".repeat(40)),
      argocdApplicationLink("scout-prod"),
      chartmuseumChartLink("arcade", "1.0.0+abc"),
    ])
      expect(LinkSchema.parse(link)).toEqual(link);
  });
});
