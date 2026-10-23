import { describe, expect, test } from "vitest";
import { App, Chart } from "cdk8s";
import { parseAllDocuments } from "yaml";
import { z } from "zod";
import {
  MANAGED_APPLICATION_LABEL,
  ORPHAN_ROOT_ANNOTATION,
} from "@shepherdjerred/homelab/cdk8s/src/application-release-policy.ts";
import {
  APPLICATION_SOURCE_POLICY,
  APPLICATION_SOURCE_WRITERS,
  ARGOCD_ADMISSION_BINDING_SYNC_WAVE,
  ARGOCD_ADMISSION_POLICY_SYNC_WAVE,
  createArgoCdApplicationAdmissionPolicies,
} from "./argocd-application-admission.ts";

const ValidationsSchema = z.object({
  validations: z.array(
    z.object({
      expression: z.string(),
      message: z.string(),
      reason: z.string(),
    }),
  ),
});

function lifecycleValidations(transition: boolean) {
  const policy = synthesizePolicies(transition).find(
    (manifest) =>
      manifest.metadata.name === "argocd-application-lifecycle.sjer.red" &&
      manifest.kind === "ValidatingAdmissionPolicy",
  );
  return ValidationsSchema.parse(policy?.spec).validations;
}

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

function synthesizePolicies(transition = false) {
  const app = new App();
  const chart = new Chart(app, "apps");
  createArgoCdApplicationAdmissionPolicies(chart, transition);
  return parseAllDocuments(app.synthYaml()).map((document) =>
    AdmissionManifestSchema.parse(document.toJS()),
  );
}

function policyNames(transition: boolean): string[] {
  return synthesizePolicies(transition).map(
    (manifest) => `${manifest.kind}/${manifest.metadata.name}`,
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

  test("with the switch off the retained root and ArgoCD Applications are never deletable", () => {
    const [retained, cascade] = lifecycleValidations(false);
    expect(retained).toEqual({
      expression:
        "!['apps', 'argocd'].exists(name, name == oldObject.metadata.name)",
      message:
        "retained root and ArgoCD Applications cannot be deleted while the lifecycle policy is active",
      reason: "Forbidden",
    });
    expect(retained?.expression).not.toContain(ORPHAN_ROOT_ANNOTATION);
    expect(cascade?.reason).toBe("Invalid");
  });

  test("transition rendering admits deleting only an explicitly orphaned root", () => {
    const [retained, cascade] = lifecycleValidations(true);
    expect(retained?.reason).toBe("Forbidden");
    expect(retained?.expression).toBe(
      `oldObject.metadata.name != 'argocd' && (oldObject.metadata.name != 'apps' || (has(oldObject.metadata.annotations) && '${ORPHAN_ROOT_ANNOTATION}' in oldObject.metadata.annotations && oldObject.metadata.annotations['${ORPHAN_ROOT_ANNOTATION}'] == 'true'))`,
    );
    expect(retained?.message).toContain(ORPHAN_ROOT_ANNOTATION);
    // The cascade contract and every other policy field stay as they are off.
    expect(cascade).toEqual(lifecycleValidations(false)[1]);
    const [off, on] = [false, true].map((transition) =>
      synthesizePolicies(transition)
        .filter(
          (manifest) => manifest.metadata.name !== APPLICATION_SOURCE_POLICY,
        )
        .map((manifest) =>
          manifest.kind === "ValidatingAdmissionPolicy"
            ? { ...manifest, spec: { ...manifest.spec, validations: [] } }
            : manifest,
        ),
    );
    expect(on).toEqual(off);
  });

  test("the source-writer policy exists only under transition rendering", () => {
    expect(policyNames(false)).not.toContain(
      `ValidatingAdmissionPolicy/${APPLICATION_SOURCE_POLICY}`,
    );
    expect(policyNames(true)).toEqual([
      ...policyNames(false),
      `ValidatingAdmissionPolicy/${APPLICATION_SOURCE_POLICY}`,
      `ValidatingAdmissionPolicyBinding/${APPLICATION_SOURCE_POLICY}`,
    ]);
  });

  test("only ArgoCD's own identities write a managed Application's source", () => {
    const policy = synthesizePolicies(true).find(
      (manifest) =>
        manifest.kind === "ValidatingAdmissionPolicy" &&
        manifest.metadata.name === APPLICATION_SOURCE_POLICY,
    );
    const spec = z
      .object({
        failurePolicy: z.literal("Fail"),
        matchConstraints: z.object({
          objectSelector: z.object({
            matchLabels: z.record(z.string(), z.string()),
          }),
          resourceRules: z.array(z.object({ operations: z.array(z.string()) })),
        }),
        matchConditions: z.array(
          z.object({ name: z.string(), expression: z.string() }),
        ),
        validations: z.array(
          z.object({ expression: z.string(), reason: z.string() }),
        ),
      })
      .parse(policy?.spec);
    expect(spec.matchConstraints.objectSelector.matchLabels).toEqual({
      [MANAGED_APPLICATION_LABEL]: "true",
    });
    expect(spec.matchConstraints.resourceRules[0]?.operations).toEqual([
      "CREATE",
      "UPDATE",
    ]);
    const written = spec.matchConditions.find(
      ({ name }) => name === "source-written",
    )?.expression;
    expect(written).toContain("request.operation == 'CREATE'");
    for (const field of ["source", "sources"])
      expect(written).toContain(
        `object.spec.${field} != oldObject.spec.${field}`,
      );
    expect(spec.validations).toHaveLength(1);
    const [writers] = spec.validations;
    expect(writers?.reason).toBe("Forbidden");
    for (const writer of APPLICATION_SOURCE_WRITERS)
      expect(writers?.expression).toContain(`'${writer}'`);
    expect(writers?.expression).toContain("request.userInfo.username");
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
