import { expect, test } from "vitest";
import { renderAdmissionPolicies } from "./admission-policy-test-support.ts";
import {
  CI_WORKSPACE_GOLDEN_CONFIG_MAP,
  CI_WORKSPACE_GOLDEN_SNAPSHOT_PREFIX,
  createWorkspaceClonePolicy,
} from "./workspace-clone-policy.ts";

function render() {
  return renderAdmissionPolicies(createWorkspaceClonePolicy);
}

function find(kind: string) {
  const manifest = render().find((candidate) => candidate.kind === kind);
  if (manifest === undefined) throw new Error(`Missing ${kind}`);
  return manifest;
}

test("workspace clone policies are cluster-scoped, ordered, and fail closed on new CI claims", () => {
  const manifests = render();
  expect(manifests.map((manifest) => manifest.kind)).toEqual([
    "MutatingAdmissionPolicy",
    "MutatingAdmissionPolicyBinding",
    "ValidatingAdmissionPolicy",
    "ValidatingAdmissionPolicyBinding",
  ]);
  for (const manifest of manifests) {
    expect(manifest.metadata.namespace).toBeUndefined();
    expect(manifest.metadata.annotations["argocd.argoproj.io/sync-wave"]).toBe(
      manifest.kind.endsWith("Binding") ? "-29" : "-30",
    );
    if (!manifest.kind.endsWith("Binding"))
      expect(manifest.spec).toMatchObject({
        failurePolicy: "Fail",
        matchConstraints: {
          namespaceSelector: {
            matchLabels: { "kubernetes.io/metadata.name": "woodpecker-ci" },
          },
          resourceRules: [
            {
              operations: ["CREATE"],
              resources: ["persistentvolumeclaims"],
            },
          ],
        },
      });
  }
});

test("only unsourced workspace-sized ci-workspace claims are given the golden snapshot", () => {
  const mutation = find("MutatingAdmissionPolicy");
  expect(mutation.spec).toMatchObject({
    reinvocationPolicy: "Never",
    paramKind: { apiVersion: "v1", kind: "ConfigMap" },
  });
  const conditions = JSON.stringify(mutation.spec["matchConditions"]);
  expect(conditions).toContain(
    "object.spec.storageClassName == 'ci-workspace'",
  );
  // Gate claims are 1G; a clone must equal its snapshot's size.
  expect(conditions).toContain("quantity('32G')");
  expect(conditions).toContain(
    "!(has(object.spec.dataSource) || has(object.spec.dataSourceRef))",
  );
  const patch = JSON.stringify(mutation.spec["mutations"]);
  // Atomic structs: a JSON patch, never an ApplyConfiguration.
  expect(patch).toContain('"patchType":"JSONPatch"');
  for (const field of ["dataSource", "dataSourceRef"])
    expect(patch).toContain(
      `path: '/spec/${field}', value: Object.spec.${field}{apiGroup: 'snapshot.storage.k8s.io', kind: 'VolumeSnapshot', name: params.data['snapshot']}`,
    );
  // An absent, empty, or foreign parameter leaves the claim empty.
  expect(patch).toContain(
    `params.data['snapshot'].startsWith('${CI_WORKSPACE_GOLDEN_SNAPSHOT_PREFIX}') ? [`,
  );
  expect(patch).toContain("] : []");

  expect(find("MutatingAdmissionPolicyBinding").spec).toEqual({
    policyName: "woodpecker-workspace-clone.sjer.red",
    paramRef: {
      name: CI_WORKSPACE_GOLDEN_CONFIG_MAP,
      namespace: "woodpecker-ci",
      parameterNotFoundAction: "Allow",
    },
  });
});

test("the guard admits only golden snapshot sources of the workspace size", () => {
  const guard = find("ValidatingAdmissionPolicy");
  const validations = JSON.stringify(guard.spec["validations"]);
  for (const field of ["dataSource", "dataSourceRef"])
    expect(validations).toContain(
      `object.spec.${field}.kind == 'VolumeSnapshot' && object.spec.${field}.name.startsWith('${CI_WORKSPACE_GOLDEN_SNAPSHOT_PREFIX}')`,
    );
  expect(validations).toContain("quantity('32G')");
  expect(find("ValidatingAdmissionPolicyBinding").spec).toEqual({
    policyName: "woodpecker-workspace-clone-guard.sjer.red",
    validationActions: ["Deny"],
  });
});
