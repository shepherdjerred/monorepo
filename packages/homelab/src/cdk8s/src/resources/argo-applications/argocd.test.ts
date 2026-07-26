import { describe, expect, it } from "bun:test";
import { Testing } from "cdk8s";
import { z } from "zod";
import { createArgoCdApp } from "./argocd.ts";

const ApplicationSchema = z
  .object({
    kind: z.literal("Application"),
    metadata: z.object({
      name: z.literal("argocd"),
    }),
    spec: z.object({
      source: z.object({
        helm: z.object({
          valuesObject: z.object({
            configs: z.object({
              rbac: z.object({
                "policy.csv": z.string(),
              }),
            }),
          }),
        }),
      }),
    }),
  })
  .loose();

function synthArgoCdApplication() {
  const chart = Testing.chart();
  createArgoCdApp(chart);
  const application = z
    .array(z.unknown())
    .parse(Testing.synth(chart))
    .find((manifest) => ApplicationSchema.safeParse(manifest).success);
  return ApplicationSchema.parse(application);
}

describe("ArgoCD application", () => {
  it("grants the Buildkite release step only its required application access", () => {
    const application = synthArgoCdApplication();

    expect(
      application.spec.source.helm.valuesObject.configs.rbac[
        "policy.csv"
      ].split("\n"),
    ).toEqual([
      "p, buildkite, applications, sync, default/apps, allow",
      "p, buildkite, applications, get, default/apps, allow",
      "p, buildkite, applications, get, default/argocd, allow",
      "p, buildkite, applications, delete, default/kueue, allow",
    ]);
  });
});
