import { describe, expect, test } from "bun:test";
import { App, Chart } from "cdk8s";
import { parseAllDocuments } from "yaml";
import { z } from "zod";
import { MANAGED_APPLICATION_LABEL } from "@shepherdjerred/homelab/cdk8s/src/application-release-policy.ts";
import {
  ARGOCD_ADMISSION_BINDING_SYNC_WAVE,
  ARGOCD_ADMISSION_POLICY_SYNC_WAVE,
  createArgoCdApplicationAdmissionPolicies,
} from "./argocd-application-admission.ts";

const AdmissionManifestSchema = z.object({
  apiVersion: z.literal("admissionregistration.k8s.io/v1"),
  kind: z.enum([
    "MutatingAdmissionPolicy",
    "MutatingAdmissionPolicyBinding",
    "ValidatingAdmissionPolicy",
    "ValidatingAdmissionPolicyBinding",
  ]),
  metadata: z.object({
    name: z.string(),
    annotations: z.record(z.string(), z.string()),
  }),
  spec: z.record(z.string(), z.unknown()),
});

function synthesizePolicies() {
  const app = new App();
  const chart = new Chart(app, "apps");
  createArgoCdApplicationAdmissionPolicies(chart);
  return parseAllDocuments(app.synthYaml()).map((document) =>
    AdmissionManifestSchema.parse(document.toJS()),
  );
}

describe("ArgoCD Application admission policies", () => {
  test("orders fail-closed policies before their bindings", () => {
    const manifests = synthesizePolicies();
    expect(manifests).toHaveLength(4);
    for (const manifest of manifests) {
      const expectedWave = manifest.kind.endsWith("Binding")
        ? ARGOCD_ADMISSION_BINDING_SYNC_WAVE
        : ARGOCD_ADMISSION_POLICY_SYNC_WAVE;
      expect(
        manifest.metadata.annotations["argocd.argoproj.io/sync-wave"],
      ).toBe(expectedWave);
    }
  });

  test("merges declared sync options into managed manual operations", () => {
    const policy = synthesizePolicies().find(
      (manifest) => manifest.kind === "MutatingAdmissionPolicy",
    );
    expect(policy).toBeDefined();
    expect(policy?.spec).toMatchObject({
      failurePolicy: "Fail",
      matchConstraints: {
        objectSelector: {
          matchLabels: { [MANAGED_APPLICATION_LABEL]: "true" },
        },
      },
      variables: expect.arrayContaining([
        {
          name: "mergedOptions",
          expression: expect.stringContaining("variables.declaredOptions"),
        },
      ]),
      mutations: [
        {
          patchType: "JSONPatch",
          jsonPatch: {
            expression: expect.stringContaining("/operation/sync/syncOptions"),
          },
        },
      ],
    });
  });

  test("denies retained deletion and requires cascade metadata otherwise", () => {
    const policy = synthesizePolicies().find(
      (manifest) => manifest.kind === "ValidatingAdmissionPolicy",
    );
    expect(policy).toBeDefined();
    expect(policy?.spec).toMatchObject({
      failurePolicy: "Fail",
      validations: [
        {
          expression: expect.stringContaining("'apps', 'argocd'"),
          reason: "Forbidden",
        },
        {
          expression: expect.stringContaining(
            "resources-finalizer.argocd.argoproj.io",
          ),
          reason: "Invalid",
        },
      ],
    });
  });

  test("scopes deletion checks to released Applications", () => {
    const policy = synthesizePolicies().find(
      (manifest) => manifest.kind === "ValidatingAdmissionPolicy",
    );
    const constraints = z
      .object({ objectSelector: z.unknown().optional() })
      .parse(
        z
          .object({ matchConstraints: z.record(z.string(), z.unknown()) })
          .parse(policy?.spec).matchConstraints,
      );
    expect(constraints.objectSelector).toBeUndefined();
    const conditions = z
      .array(z.object({ name: z.string(), expression: z.string() }))
      .parse(
        z.object({ matchConditions: z.unknown() }).parse(policy?.spec)
          .matchConditions,
      );
    const scope = conditions.find(
      ({ name }) => name === "release-managed-application",
    );
    expect(scope?.expression).toContain(MANAGED_APPLICATION_LABEL);
    expect(scope?.expression).toContain("'apps', 'argocd'");
  });
});
