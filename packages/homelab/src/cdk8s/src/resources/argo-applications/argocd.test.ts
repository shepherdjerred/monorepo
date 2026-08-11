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
              cm: z.object({
                "resource.customizations.health.cert-manager.io_Certificate":
                  z.string(),
                "resource.customizations.health.argoproj.io_Application":
                  z.string(),
              }),
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
      "p, buildkite, applications, sync, default/*, allow",
      "p, buildkite, applications, get, default/*, allow",
      "p, buildkite, applications, override, default/apps, allow",
    ]);
  });

  it("ignores only stale terminal operation failures in child health", () => {
    const application = synthArgoCdApplication();
    const customization =
      application.spec.source.helm.valuesObject.configs.cm[
        "resource.customizations.health.argoproj.io_Application"
      ];

    expect(customization).toContain(
      "obj.status.operationState.syncResult.revision ~= obj.status.sync.revision",
    );
    expect(customization).toContain(
      'if (phase == "Failed" or phase == "Error") and',
    );
    expect(customization).toContain(
      'hs.message = "Application operation is " .. obj.status.operationState.phase',
    );
  });

  it("keeps only non-failed cert-manager secret issuance progressing", () => {
    const application = synthArgoCdApplication();
    const customization =
      application.spec.source.helm.valuesObject.configs.cm[
        "resource.customizations.health.cert-manager.io_Certificate"
      ];

    expect(customization).toContain('condition.type == "Issuing" and');
    expect(customization).toContain('condition.reason ~= "Issued"');
    expect(customization).toContain(
      'ready.status == "False" and ready.reason ~= "DoesNotExist"',
    );
    expect(customization).toContain("if failedIssuing ~= nil then");
    expect(customization).toContain("hs.message = failedIssuing.message");
    expect(customization.indexOf("if failedIssuing ~= nil then")).toBeLessThan(
      customization.indexOf(
        'ready.status == "False" and ready.reason ~= "DoesNotExist"',
      ),
    );
    expect(customization).toContain('hs.status = "Progressing"');
    expect(customization).toContain('hs.status = "Healthy"');
    expect(customization).toContain('hs.status = "Degraded"');
  });
});
