import { expect, test } from "vitest";
import { renderAdmissionPolicies } from "@shepherdjerred/homelab/cdk8s/src/resources/woodpecker/admission-policy-test-support.ts";
import {
  CPU_REQUEST_FACTOR,
  MEMORY_REQUEST_FACTOR,
  REQUEST_OVERCOMMIT_ANNOTATION,
  REQUEST_OVERCOMMIT_POLICY,
  createRequestOvercommitPolicy,
} from "./request-overcommit.ts";

test("request overcommit scales production pods only and never blocks admission", () => {
  const manifests = renderAdmissionPolicies(createRequestOvercommitPolicy);
  expect(manifests.map((manifest) => manifest.kind)).toEqual([
    "MutatingAdmissionPolicy",
    "MutatingAdmissionPolicyBinding",
  ]);
  for (const manifest of manifests) {
    expect(manifest.metadata.name).toBe(REQUEST_OVERCOMMIT_POLICY);
    expect(manifest.metadata.namespace).toBeUndefined();
    expect(manifest.metadata.annotations["argocd.argoproj.io/sync-wave"]).toBe(
      manifest.kind.endsWith("Binding") ? "-29" : "-30",
    );
  }
  const [policy, binding] = manifests;
  expect(binding?.spec).toEqual({ policyName: REQUEST_OVERCOMMIT_POLICY });
  expect(policy?.spec).toMatchObject({
    // A capacity optimization must not block production pod creation.
    failurePolicy: "Ignore",
    // The marker annotation plus Never keeps the scaling from compounding.
    reinvocationPolicy: "Never",
    matchConstraints: {
      namespaceSelector: {
        matchExpressions: [
          {
            key: "kubernetes.io/metadata.name",
            operator: "NotIn",
            values: ["kube-system"],
          },
          {
            key: "kueue.x-k8s.io/managed-namespace",
            operator: "DoesNotExist",
          },
        ],
      },
      resourceRules: [{ operations: ["CREATE"], resources: ["pods"] }],
    },
  });
  const spec = JSON.stringify(policy?.spec);
  for (const condition of [
    "not-mirror-pod",
    "not-already-scaled",
    "not-ci-node",
    "not-guaranteed",
    "no-pod-level-resources",
  ]) {
    expect(spec).toContain(`"name":"${condition}"`);
  }
  expect(spec).toContain("kubernetes.io/config.mirror");
  expect(spec).toContain(`'liskov' in e.values`);
  expect(spec).toContain(`'${REQUEST_OVERCOMMIT_ANNOTATION}'`);
  // Only requests are rewritten; limits keep their declared bounds.
  expect(spec).not.toContain("limits:");
  expect(spec).toContain(`* ${CPU_REQUEST_FACTOR.toFixed(3)}`);
  expect(spec).toContain(`* ${MEMORY_REQUEST_FACTOR.toFixed(3)}`);
  // Burst and infrastructure pods keep their memory request.
  expect(spec).toContain("'service-burst', 'infrastructure-critical'");
  expect(spec).toContain("initContainers");
});
