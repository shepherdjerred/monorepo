import { App } from "cdk8s";
import { beforeEach, expect, test } from "vitest";
import { z } from "zod";
import { createDeliveryChart } from "@shepherdjerred/homelab/cdk8s/src/cdk8s-charts/platform/delivery.ts";
import { DELIVERY_TAILSCALE_INGRESS as identity } from "@shepherdjerred/ops-model/delivery-ingress.ts";
import {
  getRegisteredBackendProbes,
  resetProbeRegistry,
} from "@shepherdjerred/homelab/cdk8s/src/misc/probes/probe-registry.ts";
import { podTemplateSchema } from "@shepherdjerred/homelab/cdk8s/src/testing/pod-template-schema.ts";

beforeEach(resetProbeRegistry);
const resources = () =>
  createDeliveryChart(new App(), {
    image: `docker.io/shepherdjerred/delivery@sha256:${"a".repeat(64)}`,
    serviceItemId: "service-item",
  }).toJson();
const Named = z.looseObject({
  kind: z.string(),
  metadata: z.looseObject({
    name: z.string(),
    namespace: z.string().optional(),
  }),
});
const Role = Named.extend({
  kind: z.literal("Role"),
  rules: z.array(
    z.object({
      apiGroups: z.array(z.string()),
      resources: z.array(z.string()),
      verbs: z.array(z.string()),
      resourceNames: z.array(z.string()).optional(),
    }),
  ),
});

test("actual API chart delegates HTTPS and admin-only device tagging to the existing operator with no app auth key or identity volume", () => {
  const rendered = resources();
  const ingress = rendered.find((raw) => Named.parse(raw).kind === "Ingress");
  expect(ingress).toMatchObject({
    metadata: {
      namespace: identity.namespace,
      name: identity.name,
      annotations: { "tailscale.com/tags": "tag:delivery" },
    },
    spec: {
      ingressClassName: "tailscale",
      defaultBackend: { service: { name: "delivery", port: { number: 7353 } } },
      tls: [{ hosts: ["delivery"] }],
    },
  });
  const annotations = z
    .object({
      metadata: z.object({ annotations: z.record(z.string(), z.string()) }),
    })
    .parse(ingress).metadata.annotations;
  expect(annotations["tailscale.com/funnel"]).toBeUndefined();
  expect(
    rendered.filter((raw) =>
      ["PersistentVolumeClaim", "StatefulSet"].includes(Named.parse(raw).kind),
    ),
  ).toEqual([]);
  expect(JSON.stringify(rendered)).not.toContain("TS_AUTHKEY");
  expect(JSON.stringify(rendered)).not.toContain("delivery-tailnet-state");
  expect(getRegisteredBackendProbes()).toContainEqual(
    expect.objectContaining({
      namespace: "delivery",
      serviceName: "delivery",
      port: 7353,
      path: "/healthz",
    }),
  );
});

test("actual observer bindings permit only fixed Ingress get and namespace-scoped proxy metadata reads", () => {
  const rendered = resources();
  const roles = rendered.flatMap((raw) => {
    const parsed = Role.safeParse(raw);
    return parsed.success ? [parsed.data] : [];
  });
  expect(
    roles.map(({ metadata, rules }) => ({
      namespace: metadata.namespace,
      rules,
    })),
  ).toEqual([
    {
      namespace: "delivery",
      rules: [
        {
          apiGroups: ["networking.k8s.io"],
          resources: ["ingresses"],
          resourceNames: [identity.name],
          verbs: ["get"],
        },
      ],
    },
    {
      namespace: "tailscale",
      rules: [
        { apiGroups: [""], resources: ["pods"], verbs: ["list"] },
        { apiGroups: ["apps"], resources: ["statefulsets"], verbs: ["get"] },
      ],
    },
  ]);
  const bindings = rendered.filter(
    (raw) => Named.parse(raw).kind === "RoleBinding",
  );
  for (const namespace of ["delivery", "tailscale"]) {
    expect(bindings).toContainEqual(
      expect.objectContaining({
        metadata: expect.objectContaining({ namespace }),
        roleRef: {
          apiGroup: "rbac.authorization.k8s.io",
          kind: "Role",
          name: "delivery-ingress-observer",
        },
        subjects: [
          {
            kind: "ServiceAccount",
            name: "delivery-forum-observer",
            namespace: "delivery",
          },
        ],
      }),
    );
  }
  expect(bindings).toHaveLength(2);
  expect(
    rendered.filter((raw) => Named.parse(raw).kind === "ClusterRoleBinding"),
  ).toEqual([]);
  for (const role of roles)
    for (const rule of role.rules) {
      expect(
        rule.resources.some((resource) =>
          ["secrets", "pods/exec", "pods/log"].includes(resource),
        ),
      ).toBe(false);
      expect(
        rule.verbs.some((verb) =>
          ["*", "create", "update", "patch", "delete", "watch"].includes(verb),
        ),
      ).toBe(false);
    }
});

test("only the API mounts a short-lived read-only observer projection, with unchanged API resource budget", () => {
  const rendered = resources();
  const Container = z.looseObject({
    name: z.string(),
    volumeMounts: z.array(
      z.object({
        name: z.string(),
        mountPath: z.string(),
        readOnly: z.boolean().optional(),
      }),
    ),
    resources: z.unknown(),
  });
  const podBase = podTemplateSchema(Container);
  const deployment = z
    .object({
      spec: z.object({
        template: podBase.extend({
          spec: podBase.shape.spec.extend({
            serviceAccountName: z.string(),
            automountServiceAccountToken: z.boolean(),
            initContainers: z.array(
              z.looseObject({
                name: z.string(),
                volumeMounts: z.array(z.object({ name: z.string() })),
              }),
            ),
            volumes: z.array(z.looseObject({ name: z.string() })),
          }),
        }),
      }),
    })
    .parse(rendered.find((raw) => Named.parse(raw).kind === "Deployment")).spec
    .template.spec;
  expect(deployment.serviceAccountName).toBe("delivery-forum-observer");
  expect(deployment.automountServiceAccountToken).toBe(false);
  expect(deployment.containers.map((container) => container.name)).toEqual([
    "delivery",
  ]);
  expect(deployment.containers[0]?.volumeMounts).toContainEqual({
    name: "ingress-observer",
    mountPath: "/var/run/delivery-ingress",
    readOnly: true,
  });
  expect(deployment.containers[0]?.resources).toMatchObject({
    requests: { cpu: "50m", memory: "128Mi" },
    limits: { cpu: "500m", memory: "512Mi" },
  });
  expect(
    deployment.initContainers.every((container) =>
      container.volumeMounts.every(
        (mount) => mount.name !== "ingress-observer",
      ),
    ),
  ).toBe(true);
  expect(
    deployment.volumes.find((volume) => volume.name === "ingress-observer"),
  ).toEqual({
    name: "ingress-observer",
    projected: {
      defaultMode: 0o440,
      sources: [
        { serviceAccountToken: { path: "token", expirationSeconds: 600 } },
        {
          configMap: {
            name: "kube-root-ca.crt",
            items: [{ key: "ca.crt", path: "ca.crt" }],
          },
        },
      ],
    },
  });
});

test("defense-in-depth ingress pairs the exact operator namespace with all parent labels and only the API port", () => {
  const policy = z
    .object({
      spec: z.object({
        ingress: z.array(
          z.object({
            from: z.array(
              z.looseObject({
                namespaceSelector: z
                  .object({ matchLabels: z.record(z.string(), z.string()) })
                  .optional(),
                podSelector: z
                  .object({
                    matchLabels: z.record(z.string(), z.string()).optional(),
                  })
                  .optional(),
              }),
            ),
            ports: z.array(
              z.object({ port: z.number(), protocol: z.string() }),
            ),
          }),
        ),
      }),
    })
    .parse(
      resources().find((raw) => {
        const named = Named.parse(raw);
        return (
          named.kind === "NetworkPolicy" &&
          named.metadata.name.includes("application-network")
        );
      }),
    );
  const peers = policy.spec.ingress
    .flatMap((rule) => rule.from.map((peer) => ({ peer, ports: rule.ports })))
    .filter(
      ({ peer }) =>
        peer.namespaceSelector?.matchLabels["kubernetes.io/metadata.name"] ===
        "tailscale",
    );
  expect(peers).toEqual([
    {
      peer: {
        namespaceSelector: {
          matchLabels: { "kubernetes.io/metadata.name": "tailscale" },
        },
        podSelector: { matchLabels: identity.parentLabels },
      },
      ports: [{ port: 7353, protocol: "TCP" }],
    },
  ]);
  const matches = (
    namespace: string,
    labels: Record<string, string>,
    port: number,
  ) =>
    peers.some(
      ({ peer, ports }) =>
        peer.namespaceSelector?.matchLabels["kubernetes.io/metadata.name"] ===
          namespace &&
        Object.entries(peer.podSelector?.matchLabels ?? {}).every(
          ([key, value]) => labels[key] === value,
        ) &&
        ports.some((entry) => entry.port === port),
    );
  expect(matches("tailscale", identity.parentLabels, 7353)).toBe(true);
  expect(matches("default", identity.parentLabels, 7353)).toBe(false);
  for (const key of Object.keys(identity.parentLabels))
    expect(
      matches("tailscale", { ...identity.parentLabels, [key]: "wrong" }, 7353),
    ).toBe(false);
  for (const port of [443, 6443, 8080, 9002])
    expect(matches("tailscale", identity.parentLabels, port)).toBe(false);
});
