import { App, Chart } from "cdk8s";
import { expect, test } from "vitest";
import { z } from "zod";
import { createDeliveryMinecraftController } from "./minecraft-controller.ts";
import sandbox from "homelab/src/minecraft-delivery-sandbox.json" with { type: "json" };

const Rule = z.object({
  apiGroups: z.array(z.string()),
  resources: z.array(z.string()),
  verbs: z.array(z.string()),
  resourceNames: z.array(z.string()).optional(),
});
const Resources = z.array(
  z.looseObject({
    kind: z.string(),
    metadata: z.looseObject({
      name: z.string(),
      namespace: z.string().optional(),
      labels: z.record(z.string(), z.string()).optional(),
    }),
    spec: z.unknown().optional(),
    rules: z.array(Rule).optional(),
  }),
);
function fixture() {
  const chart = new Chart(new App(), "minecraft-controller-proof");
  createDeliveryMinecraftController(chart, {
    executorItemId: "executor-item",
    registryItemId: "registry-item",
    argocdItemId: "argo-item",
  });
  return Resources.parse(chart.toJson());
}

test("only the durable controller receives maintenance identity; the restored sandbox stays tokenless", () => {
  const resources = fixture();
  const namespaces = resources.filter((item) => item.kind === "Namespace");
  expect(namespaces.map((item) => item.metadata.name).sort()).toEqual([
    "delivery-tsmc-controller",
    "minecraft-tsmc-delivery-validation",
  ]);
  for (const namespace of namespaces)
    expect(
      namespace.metadata.labels?.["pod-security.kubernetes.io/enforce"],
    ).toBe("restricted");
  const controller = resources.find((item) => item.kind === "StatefulSet");
  const spec = z
    .object({
      replicas: z.literal(1),
      template: z.object({
        spec: z.object({
          serviceAccountName: z.literal("delivery-tsmc-controller"),
          automountServiceAccountToken: z.literal(true),
          securityContext: z.object({
            runAsUser: z.literal(1000),
            runAsGroup: z.literal(1000),
            fsGroup: z.literal(1000),
            fsGroupChangePolicy: z.literal("OnRootMismatch"),
          }),
          containers: z.array(
            z.object({
              command: z.array(z.string()),
              env: z.array(
                z.looseObject({
                  name: z.string(),
                  value: z.string().optional(),
                }),
              ),
              volumeMounts: z.array(z.looseObject({ name: z.string() })),
            }),
          ),
          volumes: z.array(z.looseObject({ name: z.string() })),
        }),
      }),
    })
    .parse(controller?.spec);
  expect(spec.template.spec.containers[0]?.command).toEqual([
    "bun",
    "scripts/jobs/minecraft-controller.ts",
  ]);
  expect(
    spec.template.spec.containers[0]?.env.filter(
      (entry) => entry.name === "NODE_EXTRA_CA_CERTS",
    ),
  ).toEqual([
    {
      name: "NODE_EXTRA_CA_CERTS",
      value: "/var/run/secrets/kubernetes.io/serviceaccount/ca.crt",
    },
  ]);
  expect(
    spec.template.spec.containers[0]?.env.find(
      (entry) => entry.name === "ARGOCD_AUTH_TOKEN",
    ),
  ).toEqual({
    name: "ARGOCD_AUTH_TOKEN",
    valueFrom: {
      secretKeyRef: { name: "delivery-argocd", key: "ARGOCD_TOKEN" },
    },
  });
  expect(
    resources.find(
      (item) =>
        item.kind === "OnePasswordItem" &&
        item.metadata.name === "delivery-argocd",
    ),
  ).toMatchObject({
    metadata: { namespace: "delivery-tsmc-controller" },
    spec: { itemPath: "vaults/v64ocnykdqju4ui6j6pua56xw4/items/argo-item" },
  });
  expect(
    spec.template.spec.volumes.find((volume) => volume.name === "journal"),
  ).toMatchObject({
    persistentVolumeClaim: { claimName: "delivery-tsmc-journal" },
  });
  expect(
    spec.template.spec.containers[0]?.volumeMounts.find(
      (mount) => mount.name === "journal",
    ),
  ).toMatchObject({ mountPath: "/journal" });
  expect(resources.filter((item) => item.kind === "Job")).toEqual([]);
  expect(sandbox.podTemplate.spec.automountServiceAccountToken).toBe(false);
  expect(
    sandbox.podTemplate.spec.containers[0]?.env.every(
      (item) => "value" in item,
    ),
  ).toBe(true);
  expect(
    sandbox.podTemplate.spec.volumes[0]?.persistentVolumeClaim?.claimName,
  ).toBe("datadir-minecraft-tsmc-0");
});

function assertRule(namespace: string | undefined, rule: z.infer<typeof Rule>) {
  expect(rule.resources).not.toContain("secrets");
  expect(rule.resources).not.toContain("serviceaccounts");
  expect(rule.resources).not.toContain("roles");
  expect([...rule.resources, ...rule.verbs, ...rule.apiGroups]).not.toContain(
    "*",
  );
  if (rule.resources.includes("namespaces"))
    expect(rule.verbs).toEqual(["get"]);
  if (rule.resources.includes("persistentvolumes"))
    expect(rule.verbs).toEqual(["get"]);
  if (rule.resources.includes("backups"))
    expect(rule.verbs).toEqual(["get", "create"]);
  if (rule.resources.includes("pods") && rule.verbs.includes("create"))
    expect(["minecraft-tsmc", "minecraft-tsmc-delivery-validation"]).toContain(
      namespace,
    );
}

test("controller grants cannot create identities, read Secrets, write source volumes or delete backups", () => {
  const resources = fixture();
  const roles = resources.filter(
    (item) => item.kind === "Role" || item.kind === "ClusterRole",
  );
  for (const role of roles) {
    if (role.rules === undefined) throw new Error("Role has no rules");
    for (const rule of role.rules) assertRule(role.metadata.namespace, rule);
  }
  const source = roles.find(
    (item) => item.metadata.namespace === "minecraft-tsmc",
  );
  expect(
    source?.rules?.find((rule) =>
      rule.resources.includes("persistentvolumeclaims"),
    )?.verbs,
  ).toEqual(["get", "list"]);
});

test("every controller admission capability is fail-closed and bound to only the controller identity", () => {
  const resources = fixture();
  const policies = resources.filter(
    (item) => item.kind === "ValidatingAdmissionPolicy",
  );
  expect(policies).toHaveLength(10);
  for (const policy of policies) {
    const spec = z
      .object({
        failurePolicy: z.literal("Fail"),
        matchConditions: z.array(z.object({ expression: z.string() })),
      })
      .parse(policy.spec);
    expect(spec.matchConditions).toEqual([
      {
        expression:
          "request.userInfo.username == 'system:serviceaccount:delivery-tsmc-controller:delivery-tsmc-controller'",
      },
    ]);
  }
  const bindings = resources.filter(
    (item) => item.kind === "ValidatingAdmissionPolicyBinding",
  );
  expect(bindings.map((item) => item.metadata.name).sort()).toEqual(
    policies.map((item) => item.metadata.name).sort(),
  );
  for (const binding of bindings)
    expect(
      z
        .object({ validationActions: z.array(z.literal("Deny")) })
        .parse(binding.spec).validationActions,
    ).toEqual(["Deny"]);
});
