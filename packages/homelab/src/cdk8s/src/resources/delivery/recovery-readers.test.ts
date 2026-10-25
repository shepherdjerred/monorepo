import { App } from "cdk8s";
import { beforeEach, expect, test } from "vitest";
import { z } from "zod";
import { createDeliveryChart } from "@shepherdjerred/homelab/cdk8s/src/cdk8s-charts/platform/delivery.ts";
import { resetProbeRegistry } from "@shepherdjerred/homelab/cdk8s/src/misc/probes/probe-registry.ts";
import { DELIVERY_TAILSCALE_INGRESS as ingress } from "@shepherdjerred/ops-model/delivery-ingress.ts";
import {
  DELIVERY_API_SERVICE_ACCOUNT as api,
  DELIVERY_KUBERNETES_READERS,
} from "@shepherdjerred/ops-model/delivery-readers.ts";
import stages from "@shepherdjerred/homelab/cdk8s/src/resources/storm-forum/releases.json" with { type: "json" };

beforeEach(resetProbeRegistry);
const Named = z.looseObject({
  kind: z.string(),
  metadata: z.looseObject({
    name: z.string(),
    namespace: z.string().optional(),
  }),
});
const Rule = z.object({
  apiGroups: z.array(z.string()),
  resources: z.array(z.string()),
  verbs: z.array(z.string()),
  resourceNames: z.array(z.string()).optional(),
});
const Role = Named.extend({ rules: z.array(Rule) });
const Binding = Named.extend({
  roleRef: z.object({ kind: z.string(), name: z.string() }),
  subjects: z.array(
    z.object({ kind: z.string(), name: z.string(), namespace: z.string() }),
  ),
});
const Mount = z.object({
  name: z.string(),
  mountPath: z.string(),
  readOnly: z.boolean().optional(),
});
const Pod = z.object({
  spec: z.object({
    template: z.object({
      spec: z.object({
        serviceAccountName: z.string(),
        automountServiceAccountToken: z.boolean(),
        containers: z.array(
          z.looseObject({ name: z.string(), volumeMounts: z.array(Mount) }),
        ),
        initContainers: z.array(
          z.looseObject({ name: z.string(), volumeMounts: z.array(Mount) }),
        ),
        volumes: z.array(z.looseObject({ name: z.string() })),
      }),
    }),
  }),
});
const readers = Object.values(DELIVERY_KUBERNETES_READERS);

function apiChart() {
  return createDeliveryChart(new App(), {
    image: `docker.io/shepherdjerred/delivery@sha256:${"a".repeat(64)}`,
    serviceItemId: "service-item",
  }).toJson();
}
function of(rendered: unknown[], kind: string, name: string) {
  return rendered.filter((raw) => {
    const parsed = Named.parse(raw);
    return parsed.kind === kind && parsed.metadata.name === name;
  });
}

test("every settlement reader is a read-only Role on exactly its resources, bound only to the API account", () => {
  const rendered = apiChart();
  for (const reader of readers) {
    const roles = of(rendered, "Role", reader.name).map((raw) =>
      Role.parse(raw),
    );
    expect(roles.map((role) => role.metadata.namespace)).toEqual(
      reader.namespaces,
    );
    for (const role of roles) {
      expect(role.rules).toEqual(
        reader.rules.map((rule) => ({
          apiGroups: [...rule.apiGroups],
          resources: [...rule.resources],
          verbs: [...rule.verbs],
        })),
      );
      for (const rule of role.rules) {
        expect(rule.verbs).toEqual(["get", "list", "watch"]);
        expect(rule.resources).not.toContain("secrets");
        expect([...rule.apiGroups, ...rule.resources]).not.toContain("*");
      }
    }
    const bindings = of(rendered, "RoleBinding", reader.name).map((raw) =>
      Binding.parse(raw),
    );
    expect(bindings).toHaveLength(reader.namespaces.length);
    for (const binding of bindings) {
      expect(binding.roleRef).toMatchObject({
        kind: "Role",
        name: reader.name,
      });
      expect(binding.subjects).toEqual([{ kind: "ServiceAccount", ...api }]);
    }
  }
  expect(
    of(rendered, "ClusterRoleBinding", "delivery-application-reader"),
  ).toEqual([]);
});

/** `namespace/Role` for every binding in `rendered` whose subject is the API account. */
function apiGrants(rendered: unknown[]) {
  return rendered
    .flatMap((raw) => {
      const kind = Named.parse(raw).kind;
      if (kind !== "RoleBinding" && kind !== "ClusterRoleBinding") return [];
      const binding = Binding.parse(raw);
      const scope =
        kind === "ClusterRoleBinding"
          ? "cluster"
          : (binding.metadata.namespace ?? "");
      return binding.subjects.some(
        (subject) =>
          subject.kind === "ServiceAccount" &&
          subject.name === api.name &&
          subject.namespace === api.namespace,
      )
        ? [`${scope}/${binding.roleRef.name}`]
        : [];
    })
    .toSorted();
}

/** `namespace/Role:verb resource` for every non-read verb among `grants`' Roles. */
function nonReadVerbs(rendered: unknown[], grants: readonly string[]) {
  return rendered
    .flatMap((raw) => {
      const named = Named.parse(raw);
      const grant = `${named.metadata.namespace ?? ""}/${named.metadata.name}`;
      return named.kind === "Role" && grants.includes(grant)
        ? Role.parse(raw).rules.flatMap((rule) =>
            rule.verbs
              .filter((verb) => !["get", "list", "watch"].includes(verb))
              .flatMap((verb) =>
                rule.resources.map(
                  (resource) => `${grant}:${verb} ${resource}`,
                ),
              ),
          )
        : [];
    })
    .toSorted();
}

function pairs(name: string, namespaces: readonly string[]) {
  return namespaces.map((namespace) => `${namespace}/${name}`);
}

test("every reader token is the API account, so its whole authority is pinned: read-only Roles plus the fenced Forum exec", () => {
  // Kubernetes projects only the pod's own ServiceAccount, so every reader
  // token carries this union; a grant added to the account must be added
  // here deliberately. Production activates the optional Forum observer.
  const rendered = createDeliveryChart(new App(), {
    image: `docker.io/shepherdjerred/delivery@sha256:${"a".repeat(64)}`,
    serviceItemId: "service-item",
    forumReaderItemId: "forum-reader-item",
    forumObserverItemId: "forum-observer-item",
  }).toJson();
  const forum = pairs(
    "delivery-forum-observer",
    stages.releases.map((stage) =>
      stage.stage === "prod" ? "storm-forum" : "storm-forum-beta",
    ),
  );
  const grants = apiGrants(rendered);
  expect(grants).toEqual(
    [
      ...pairs("delivery-ingress-observer", [
        ingress.namespace,
        ingress.proxyNamespace,
      ]),
      ...forum,
      ...readers.flatMap((reader) => pairs(reader.name, reader.namespaces)),
    ].toSorted(),
  );
  // The only non-read grant is the Forum's CONNECT, which the
  // delivery-forum-observer admission policy fences to one readonly command.
  expect(nonReadVerbs(rendered, grants)).toEqual(
    forum.map((grant) => `${grant}:create pods/exec`).toSorted(),
  );
});

test("only the API container projects one short-lived token per reader", () => {
  const rendered = apiChart();
  const deployment = Pod.parse(
    rendered.find((raw) => Named.parse(raw).kind === "Deployment"),
  ).spec.template.spec;
  expect(deployment.serviceAccountName).toBe(api.name);
  expect(deployment.automountServiceAccountToken).toBe(false);
  for (const reader of readers) {
    expect(deployment.containers[0]?.volumeMounts).toContainEqual({
      name: reader.name,
      mountPath: reader.directory,
      readOnly: true,
    });
    expect(
      deployment.volumes.find((volume) => volume.name === reader.name),
    ).toEqual({
      name: reader.name,
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
  }
  const names = new Set(readers.map((reader) => reader.name));
  for (const init of deployment.initContainers)
    expect(init.volumeMounts.some((mount) => names.has(mount.name))).toBe(
      false,
    );
  expect(new Set(readers.map((reader) => reader.directory)).size).toBe(
    readers.length,
  );
});
