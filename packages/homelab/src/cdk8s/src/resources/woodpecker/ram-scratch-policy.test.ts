import { App, Chart } from "cdk8s";
import { expect, test } from "vitest";
import { parseAllDocuments } from "yaml";
import { z } from "zod";
import { RAM_SCRATCH } from "@shepherdjerred/woodpecker-config-extension/src/pipeline/ram-scratch.ts";
import { createRamScratchPolicy } from "./ram-scratch-policy.ts";

const Manifest = z.object({
  kind: z.string(),
  metadata: z.object({
    name: z.string(),
    namespace: z.string().optional(),
    annotations: z.record(z.string(), z.string()),
  }),
  spec: z.record(z.string(), z.unknown()),
});

test("RAM scratch policies preserve namespace isolation and fail closed before workloads", () => {
  const app = new App();
  createRamScratchPolicy(new Chart(app, "scratch"));
  const manifests = parseAllDocuments(app.synthYaml()).map((doc) =>
    Manifest.parse(doc.toJS()),
  );
  expect(manifests).toHaveLength(4);
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
  const mutator = manifests.find(
    (manifest) => manifest.kind === "MutatingAdmissionPolicy",
  );
  const validator = manifests.find(
    (manifest) => manifest.kind === "ValidatingAdmissionPolicy",
  );
  expect(mutator?.spec).toMatchObject({ reinvocationPolicy: "IfNeeded" });
  const expressions = JSON.stringify({
    mutator: mutator?.spec,
    validator: validator?.spec,
  });
  for (const volume of RAM_SCRATCH.volumes) {
    expect(expressions).toContain(volume.name);
    expect(expressions).toContain(volume.path);
    expect(expressions).toContain(volume.size);
  }
  expect(expressions).toContain("compareTo(quantity('30Gi'))");
  expect(expressions).toContain("compareTo(quantity('36Gi'))");
  expect(expressions).toContain("startsWith('ci-canary/')");
  expect(expressions).toContain("object.spec.containers.size() == 1");
});
