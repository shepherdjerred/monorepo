import { describe, expect, test } from "vitest";
import { App, Chart } from "cdk8s";
import { parseAllDocuments } from "yaml";
import { z } from "zod";
import { createMinecraftTsmcApp } from "./argo-applications/games/minecraft-tsmc.ts";
import {
  createMinecraftMiningResetGuard,
  MINING_RESET_IMAGE_ANNOTATION,
  MINING_RESET_LOCK_ANNOTATION,
} from "./minecraft-mining-reset-guard.ts";

const ManifestSchema = z.object({
  kind: z.string(),
  metadata: z.object({ name: z.string() }),
  spec: z.record(z.string(), z.unknown()),
});

describe("The Storm mining reset guard", () => {
  test("denies wake-up while a maintenance lock is held", () => {
    const app = new App();
    const chart = new Chart(app, "apps");
    createMinecraftMiningResetGuard(chart);
    const manifests = parseAllDocuments(app.synthYaml()).map((document) =>
      ManifestSchema.parse(document.toJS()),
    );
    expect(manifests).toHaveLength(2);
    const policy = manifests.find(
      (manifest) => manifest.kind === "ValidatingAdmissionPolicy",
    );
    expect(policy?.spec).toMatchObject({
      failurePolicy: "Fail",
      matchConditions: [
        {
          expression: expect.stringContaining(
            "object.metadata.namespace == 'minecraft-tsmc'",
          ),
        },
      ],
      validations: [
        {
          expression: expect.stringContaining(MINING_RESET_LOCK_ANNOTATION),
          reason: "Forbidden",
        },
      ],
    });
    const binding = manifests.find(
      (manifest) => manifest.kind === "ValidatingAdmissionPolicyBinding",
    );
    expect(binding?.spec).toMatchObject({ validationActions: ["Deny"] });
  });

  test("lets ArgoCD preserve both maintenance annotations", () => {
    const app = new App();
    const chart = new Chart(app, "apps");
    createMinecraftTsmcApp(chart);
    const application = parseAllDocuments(app.synthYaml())
      .map((document) =>
        z
          .object({ kind: z.string(), spec: z.unknown().optional() })
          .parse(document.toJS()),
      )
      .find((manifest) => manifest.kind === "Application");
    const spec = z
      .object({
        ignoreDifferences: z.array(
          z.object({ kind: z.string(), jsonPointers: z.array(z.string()) }),
        ),
      })
      .parse(application?.spec);
    expect(
      spec.ignoreDifferences.find((entry) => entry.kind === "StatefulSet")
        ?.jsonPointers,
    ).toContain("/metadata/annotations/sjer.red~1mining-reset-lock");
    expect(
      spec.ignoreDifferences.find((entry) => entry.kind === "StatefulSet")
        ?.jsonPointers,
    ).toContain(
      `/metadata/annotations/${MINING_RESET_IMAGE_ANNOTATION.replaceAll("/", "~1")}`,
    );
    expect(
      spec.ignoreDifferences.find((entry) => entry.kind === "Service")
        ?.jsonPointers,
    ).toContain("/metadata/annotations/mc-router.itzg.me~1autoScaleUp");
  });
});
