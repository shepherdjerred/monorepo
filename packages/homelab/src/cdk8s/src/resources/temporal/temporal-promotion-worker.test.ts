import { App, Chart } from "cdk8s";
import { Secret } from "cdk8s-plus-31";
import { parseAllDocuments } from "yaml";
import { z } from "zod/v4";
import { describe, expect, it } from "vitest";
import { createTemporalPromotionWorker } from "./workers/promotion-worker.ts";

const DeploymentSchema = z.object({
  kind: z.literal("Deployment"),
  spec: z.object({
    template: z.object({
      spec: z.object({
        automountServiceAccountToken: z.boolean(),
        containers: z.array(
          z.object({
            env: z.array(
              z.object({ name: z.string(), value: z.string().optional() }),
            ),
            securityContext: z.object({
              runAsUser: z.number(),
              allowPrivilegeEscalation: z.boolean(),
            }),
          }),
        ),
        initContainers: z.array(z.object({ args: z.array(z.string()) })),
      }),
    }),
  }),
});

describe("promotion worker authority", () => {
  it("keeps publication credentials in the parent role and retains provider isolation", () => {
    const app = new App();
    const chart = new Chart(app, "temporal", { namespace: "temporal" });
    createTemporalPromotionWorker(chart, {
      serverServiceName: "temporal-server",
      temporalSecret: Secret.fromSecretName(
        chart,
        "test-secret",
        "temporal-worker",
      ),
    });
    const deployment = parseAllDocuments(app.synthYaml())
      .map((document) => DeploymentSchema.safeParse(document.toJSON()))
      .find((parsed) => parsed.success);
    if (deployment?.success !== true)
      throw new Error("Promotion Deployment missing");
    const pod = deployment.data.spec.template.spec;
    const container = pod.containers[0];
    if (container === undefined) throw new Error("Promotion container missing");
    const names = container.env.map((variable) => variable.name);
    expect(names).toContain("ANTI_CAPTCHA_API_KEY");
    expect(names).toContain("PINCHTAB_TOKEN");
    expect(names).toContain("STORM_PROMOTION_LOGINS");
    expect(names).not.toContain("POSTAL_API_KEY");
    expect(names).not.toContain("GH_TOKEN");
    expect(names).not.toContain("CLAUDE_CODE_OAUTH_TOKEN");
    expect(container.env).toContainEqual({
      name: "TEMPORAL_WORKER_ROLE",
      value: "promotion",
    });
    expect(pod.automountServiceAccountToken).toBe(false);
    expect(container.securityContext).toMatchObject({
      runAsUser: 0,
      allowPrivilegeEscalation: false,
    });
    expect(pod.initContainers[0]?.args.join(" ")).toContain("--uid-owner 1001");
  });
});
