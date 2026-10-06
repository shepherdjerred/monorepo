import { describe, expect, test } from "vitest";
import { App, Chart } from "cdk8s";
import { parseAllDocuments } from "yaml";
import { z } from "zod";
import {
  createMinecraftRestorationGuard,
  RESTORE_LEASE_ANNOTATION,
  RESTORE_PHASE_ANNOTATION,
  RESTORE_IMAGE_ANNOTATION,
  RESTORE_ACCESS_SELECTOR,
} from "./minecraft-restoration-guard.ts";
import { createMinecraftTsmcApp } from "./argo-applications/games/minecraft-tsmc.ts";

const Resource = z.object({ kind: z.string(), spec: z.unknown().optional() });

describe("world restoration maintenance guard", () => {
  test("requires an exclusive stopped lease and restricts private acceptance to the pinned image", () => {
    const app = new App();
    createMinecraftRestorationGuard(new Chart(app, "apps"));
    const resources = parseAllDocuments(app.synthYaml()).map((document) =>
      Resource.parse(document.toJS()),
    );
    expect(resources).toHaveLength(6);
    const policy = z
      .object({
        failurePolicy: z.literal("Fail"),
        validations: z.array(
          z.object({ expression: z.string(), reason: z.literal("Forbidden") }),
        ),
      })
      .parse(
        resources.find(
          (resource) => resource.kind === "ValidatingAdmissionPolicy",
        )?.spec,
      );
    expect(policy.validations).toHaveLength(5);
    expect(policy.validations[0]?.expression).toContain(
      "oldObject.metadata.annotations",
    );
    expect(policy.validations[0]?.expression).toContain(
      "object.spec.replicas == 0",
    );
    expect(policy.validations[0]?.expression).toContain(
      "oldObject.spec.replicas == 0",
    );
    expect(policy.validations[1]?.expression).toContain(
      "sjer.red/mining-reset-lock",
    );
    expect(policy.validations[2]?.expression).toContain(
      RESTORE_PHASE_ANNOTATION,
    );
    expect(policy.validations[3]?.expression).toContain("'VALIDATING'");
    expect(policy.validations[3]?.expression).toContain(
      RESTORE_IMAGE_ANNOTATION,
    );
    expect(policy.validations[4]?.expression).toContain(
      "oldObject.spec.replicas == 0",
    );
    expect(
      resources.find(
        (resource) => resource.kind === "ValidatingAdmissionPolicyBinding",
      )?.spec,
    ).toMatchObject({ validationActions: ["Deny"] });
  });

  test("guards scale requests using the current parent lease and fails closed without that parent", () => {
    const app = new App();
    createMinecraftRestorationGuard(new Chart(app, "apps"));
    const resources = parseAllDocuments(app.synthYaml()).map((document) =>
      Resource.parse(document.toJS()),
    );
    const policy = resources.filter(
      (resource) => resource.kind === "ValidatingAdmissionPolicy",
    )[1];
    expect(policy?.spec).toMatchObject({
      failurePolicy: "Fail",
      paramKind: { apiVersion: "apps/v1", kind: "StatefulSet" },
      matchConstraints: {
        resourceRules: [
          { resources: ["statefulsets/scale"], operations: ["UPDATE"] },
        ],
      },
    });
    const validations = z
      .object({
        validations: z.array(z.object({ expression: z.string() })),
      })
      .parse(policy?.spec).validations;
    expect(validations[0]?.expression).toContain("params.metadata.annotations");
    expect(validations[0]?.expression).toContain("object.spec.replicas == 0");
    expect(validations[0]?.expression).toContain(
      "params.spec.template.spec.containers[0].image",
    );
    expect(
      resources.filter(
        (resource) => resource.kind === "ValidatingAdmissionPolicyBinding",
      )[1]?.spec,
    ).toMatchObject({
      validationActions: ["Deny"],
      paramRef: {
        name: "minecraft-tsmc",
        namespace: "minecraft-tsmc",
        parameterNotFoundAction: "Deny",
      },
    });
  });

  test("denies deletion of the leased parent without dereferencing the absent new object", () => {
    const app = new App();
    createMinecraftRestorationGuard(new Chart(app, "apps"));
    const policies = parseAllDocuments(app.synthYaml())
      .map((document) => Resource.parse(document.toJS()))
      .filter((resource) => resource.kind === "ValidatingAdmissionPolicy");
    expect(policies[2]?.spec).toMatchObject({
      failurePolicy: "Fail",
      matchConstraints: {
        resourceRules: [
          { resources: ["statefulsets"], operations: ["DELETE"] },
        ],
      },
      matchConditions: [
        {
          expression:
            "request.namespace == 'minecraft-tsmc' && request.name == 'minecraft-tsmc'",
        },
      ],
      validations: [
        {
          expression: `!(has(oldObject.metadata.annotations) && '${RESTORE_LEASE_ANNOTATION}' in oldObject.metadata.annotations)`,
          reason: "Forbidden",
        },
      ],
    });
  });

  test("preserves operator-owned restore annotations through Argo reconciliation", () => {
    const app = new App();
    createMinecraftTsmcApp(new Chart(app, "apps"));
    const resource = parseAllDocuments(app.synthYaml())
      .map((document) => Resource.parse(document.toJS()))
      .find((item) => item.kind === "Application");
    const spec = z
      .object({
        ignoreDifferences: z.array(
          z.object({ kind: z.string(), jsonPointers: z.array(z.string()) }),
        ),
      })
      .parse(resource?.spec);
    const pointers = spec.ignoreDifferences.find(
      (item) => item.kind === "StatefulSet",
    )?.jsonPointers;
    for (const annotation of [
      RESTORE_LEASE_ANNOTATION,
      RESTORE_PHASE_ANNOTATION,
      RESTORE_IMAGE_ANNOTATION,
    ]) {
      expect(pointers).toContain(
        `/metadata/annotations/${annotation.replaceAll("/", "~1")}`,
      );
    }
    expect(
      spec.ignoreDifferences.find((item) => item.kind === "Service")
        ?.jsonPointers,
    ).toEqual(
      expect.arrayContaining([
        `/metadata/annotations/${RESTORE_LEASE_ANNOTATION.replaceAll("/", "~1")}`,
        `/spec/selector/${RESTORE_ACCESS_SELECTOR.replaceAll("/", "~1")}`,
      ]),
    );
  });
});
