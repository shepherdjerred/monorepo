import { App, Chart, Testing } from "cdk8s";
import { expect, it } from "vitest";
import { z } from "zod";
import { createStormForumApplications, forumReleases } from "./releases.ts";

it("preserves only each versioned release Job template while keeping health and new releases observable", () => {
  const app = new App();
  const chart = new Chart(app, "forum-applications");
  createStormForumApplications(chart);
  const schema = z.object({
    spec: z.object({
      ignoreDifferences: z.array(
        z
          .object({
            group: z.string(),
            kind: z.string(),
            name: z.string(),
            namespace: z.string(),
            jsonPointers: z.array(z.string()),
          })
          .strict(),
      ),
      syncPolicy: z.object({ syncOptions: z.array(z.string()) }),
    }),
  });
  const applications = Testing.synth(chart);
  expect(applications).toHaveLength(forumReleases.length);
  for (const [index, release] of forumReleases.entries()) {
    const spec = schema.parse(applications[index]).spec;
    const namespace =
      release.stage === "beta" ? "storm-forum-beta" : "storm-forum";
    expect(spec.ignoreDifferences).toEqual([
      {
        group: "batch",
        kind: "Job",
        namespace,
        name: `storm-forum-${release.restore ? "restore" : "release"}-${release.releaseId}`,
        jsonPointers: ["/spec/template"],
      },
    ]);
    expect(spec.syncPolicy.syncOptions).toContain(
      "RespectIgnoreDifferences=true",
    );
  }
});
