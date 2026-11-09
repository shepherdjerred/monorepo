import { expect, test } from "vitest";
import { RAM_SCRATCH_PROFILES } from "@shepherdjerred/woodpecker-config-extension/src/pipeline/ram-scratch.ts";
import { renderAdmissionPolicies } from "./admission-policy-test-support.ts";
import { createRamScratchPolicy } from "./ram-scratch-policy.ts";

test("RAM scratch policies preserve namespace isolation and fail closed before workloads", () => {
  const manifests = renderAdmissionPolicies(createRamScratchPolicy);
  // One mutation and binding per lane profile (verify, verify-extended,
  // playwright-e2e), plus the shared guard pair.
  expect(manifests).toHaveLength(8);
  for (const manifest of manifests) {
    expect(manifest.metadata.namespace).toBeUndefined();
    expect(manifest.metadata.annotations["argocd.argoproj.io/sync-wave"]).toBe(
      manifest.kind.endsWith("Binding") ? "-29" : "-30",
    );
    if (!manifest.kind.endsWith("Binding")) {
      expect(manifest.spec).toMatchObject({
        failurePolicy: "Fail",
        matchConstraints: {
          namespaceSelector: {
            matchLabels: { "kubernetes.io/metadata.name": "woodpecker-ci" },
          },
          resourceRules: [{ operations: ["CREATE"], resources: ["pods"] }],
        },
      });
    }
  }
  const mutators = manifests.filter(
    (manifest) => manifest.kind === "MutatingAdmissionPolicy",
  );
  const validator = manifests.find(
    (manifest) => manifest.kind === "ValidatingAdmissionPolicy",
  );
  expect(mutators.map((mutator) => mutator.metadata.name)).toEqual([
    "woodpecker-ram-scratch.sjer.red",
    "woodpecker-ram-scratch-verify-extended.sjer.red",
    "woodpecker-ram-scratch-playwright-e2e.sjer.red",
  ]);
  const validation = JSON.stringify(validator?.spec);
  for (const profile of Object.values(RAM_SCRATCH_PROFILES)) {
    const mutator = mutators.find((candidate) =>
      JSON.stringify(candidate.spec).includes(`== '${profile.profile}'`),
    );
    expect(mutator?.spec).toMatchObject({ reinvocationPolicy: "IfNeeded" });
    const mutation = JSON.stringify(mutator?.spec);
    // Each lane's mutation matches only its own step key and mounts only its volumes.
    expect(mutation).toContain(
      `object.metadata.labels['ci.sjer.red/step-key'] == '${profile.stepKey}'`,
    );
    for (const volume of profile.volumes) {
      expect(mutation).toContain(`sizeLimit: '${volume.size}'`);
      expect(mutation).toContain(volume.path);
      expect(validation).toContain(volume.name);
    }
    expect(validation).toContain(
      `compareTo(quantity('${profile.resources.memoryRequest}'))`,
    );
    expect(validation).toContain(
      `compareTo(quantity('${profile.resources.memoryLimit}'))`,
    );
  }
  const browser = mutators.find(
    (mutator) =>
      mutator.metadata.name ===
      "woodpecker-ram-scratch-playwright-e2e.sjer.red",
  );
  expect(JSON.stringify(browser?.spec)).not.toContain("ci-ram-gradle");
  // The nightly extended verify reuses verify's allowance under its own key:
  // its mutation fires only for a pod carrying the verify-extended-v1 profile
  // on the verify-extended step, never for an ordinary verify pod.
  const extended = mutators.find(
    (mutator) =>
      mutator.metadata.name ===
      "woodpecker-ram-scratch-verify-extended.sjer.red",
  );
  const extendedConditions = extended?.spec["matchConditions"];
  const extendedMatch = JSON.stringify(extendedConditions);
  expect(extendedConditions).toHaveLength(1);
  expect(extendedMatch).toContain(
    `object.metadata.labels['${RAM_SCRATCH_PROFILES.verify.label}'] == 'verify-extended-v1'`,
  );
  expect(extendedMatch).toContain(
    "object.metadata.labels['ci.sjer.red/step-key'] == 'verify-extended'",
  );
  expect(extendedMatch).not.toContain("== 'verify-v1'");
  expect(extendedMatch).not.toContain("step-key'] == 'verify'");
  // Ordinary branches and events qualify; only the lane and container shape are fixed.
  expect(validation).not.toContain("ci-canary/");
  expect(validation).not.toContain("ci.sjer.red/event");
  expect(validation).toContain("object.spec.containers.size() == 1");
});
