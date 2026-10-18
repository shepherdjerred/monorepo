import { describe, expect, it } from "vitest";
import {
  argocdApplicationLink,
  chartmuseumChartLink,
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

  it("produces schema-valid links", () => {
    for (const link of [
      githubCommitLink("a".repeat(40)),
      argocdApplicationLink("scout-prod"),
      chartmuseumChartLink("arcade", "1.0.0+abc"),
    ])
      expect(LinkSchema.parse(link)).toEqual(link);
  });
});
