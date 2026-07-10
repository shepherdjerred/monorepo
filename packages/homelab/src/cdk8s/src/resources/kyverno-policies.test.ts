import { describe, expect, it } from "bun:test";
import { App, Chart } from "cdk8s";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { createResourceLimitEnforcementPolicy } from "@shepherdjerred/homelab/cdk8s/src/resources/kyverno-policies.ts";

const ClusterPolicySchema = z.object({
  apiVersion: z.literal("kyverno.io/v1"),
  kind: z.literal("ClusterPolicy"),
  metadata: z.object({ name: z.string() }).loose(),
  spec: z
    .object({
      validationFailureAction: z.string(),
      rules: z.array(
        z
          .object({
            match: z.object({
              any: z.array(
                z
                  .object({
                    resources: z
                      .object({
                        kinds: z.array(z.string()).optional(),
                        namespaces: z.array(z.string()).optional(),
                      })
                      .loose(),
                  })
                  .loose(),
              ),
            }),
          })
          .loose(),
      ),
    })
    .loose(),
});

function synthResourceLimitPolicy(): z.infer<typeof ClusterPolicySchema> {
  const app = new App();
  const chart = new Chart(app, "test", {});
  createResourceLimitEnforcementPolicy(chart);

  const documents = app
    .synthYaml()
    .split(/^---$/m)
    .map((doc) => doc.trim())
    .filter((doc) => doc.length > 0)
    .map((document): unknown => parseYaml(document));

  for (const document of documents) {
    const result = ClusterPolicySchema.safeParse(document);
    if (
      result.success &&
      result.data.metadata.name === "enforce-container-resource-limits"
    ) {
      return result.data;
    }
  }
  throw new Error(
    "resource-limit-enforcement ClusterPolicy was not synthesized",
  );
}

describe("createResourceLimitEnforcementPolicy", () => {
  it("is in Audit mode, not Enforce", () => {
    const policy = synthResourceLimitPolicy();
    // Must stay Audit until PolicyReports confirm zero drift — an accidental
    // flip to Enforce would start blocking pod admission cluster-wide.
    expect(policy.spec.validationFailureAction).toBe("Audit");
  });

  it("is scoped to only the dagger and buildkite namespaces", () => {
    const policy = synthResourceLimitPolicy();
    const namespaces = policy.spec.rules.flatMap((rule) =>
      rule.match.any.flatMap((m) => m.resources.namespaces ?? []),
    );
    expect(namespaces.sort()).toEqual(["buildkite", "dagger"]);
  });
});
