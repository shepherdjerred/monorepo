import { describe, expect, test } from "vitest";
import { z } from "zod";
import {
  findResource,
  scoutResources,
  scoutResourcesWithGatewayTopology,
} from "@shepherdjerred/homelab/cdk8s/src/scout-test-resources.ts";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";
import {
  SCOUT_GATEWAY_POD_SELECTOR,
  SCOUT_GATEWAY_RETIREMENT_GATE_NAME,
} from "@shepherdjerred/homelab/cdk8s/src/resources/scout/gateway-retirement-gate.ts";

/**
 * The termination gate between the gateway's scale-to-zero and the backend's
 * return to `combined`.
 *
 * A zero-replica Deployment reports Healthy while its last pod is still
 * terminating, so wave ordering alone lets the backend open a Discord session
 * while the gateway pod still holds the token. These assertions pin the Job
 * that closes that gap, the wave it sits in, and the privileges it runs with.
 */

const GATE = SCOUT_GATEWAY_RETIREMENT_GATE_NAME;
const SYNC_WAVE = "argocd.argoproj.io/sync-wave";

const AnnotatedSchema = z.looseObject({
  metadata: z.looseObject({
    annotations: z.record(z.string(), z.string()).optional(),
  }),
});

const GateJobSpecSchema = z.object({
  backoffLimit: z.number(),
  activeDeadlineSeconds: z.number(),
  template: z.object({
    metadata: z.object({ labels: z.record(z.string(), z.string()) }),
    spec: z.looseObject({
      serviceAccountName: z.string(),
      automountServiceAccountToken: z.boolean(),
      containers: z.array(
        z.looseObject({
          image: z.string(),
          command: z.array(z.string()),
          args: z.array(z.string()),
        }),
      ),
    }),
  }),
});

const RoleSchema = z.looseObject({
  metadata: z.looseObject({ namespace: z.string() }),
  rules: z.array(z.unknown()),
});

const RoleBindingSchema = z.looseObject({
  metadata: z.looseObject({ namespace: z.string() }),
  roleRef: z.object({
    apiGroup: z.string(),
    kind: z.string(),
    name: z.string(),
  }),
  subjects: z.array(z.unknown()),
});

const NetworkPolicySpecSchema = z.object({
  podSelector: z.object({ matchLabels: z.record(z.string(), z.string()) }),
  policyTypes: z.array(z.string()),
  egress: z.array(z.unknown()),
  ingress: z.array(z.unknown()).optional(),
});

const GatewayPodLabelsSchema = z.object({
  template: z.object({
    metadata: z.object({ labels: z.record(z.string(), z.string()) }),
  }),
});

function retiringBeta() {
  return scoutResourcesWithGatewayTopology("beta", "retiring");
}

type Resources = ReturnType<typeof retiringBeta>;

/** Every resource the gate contributes, by the name they all share. */
function gateResources(resources: Resources) {
  return resources.filter((resource) =>
    resource.metadata.name.startsWith(GATE),
  );
}

function annotations(resources: Resources, kind: string, name: string) {
  return (
    AnnotatedSchema.parse(findResource(resources, kind, name)).metadata
      .annotations ?? {}
  );
}

function wave(resources: Resources, kind: string, name: string): number {
  // Unannotated means ArgoCD's default wave 0, which is the backend's.
  return Number(annotations(resources, kind, name)[SYNC_WAVE] ?? "0");
}

function gateJob(resources: Resources) {
  return GateJobSpecSchema.parse(findResource(resources, "Job", GATE).spec);
}

/** Whether `labels` satisfy an equality-only `key=value[,key=value]` selector. */
function selectorMatches(
  selector: string,
  labels: Record<string, string>,
): boolean {
  return selector.split(",").every((term) => {
    const [key, value] = term.split("=");
    return key !== undefined && labels[key] === value;
  });
}

describe("Scout gateway retirement gate rendering", () => {
  test("retiring renders the gate's Job, RBAC and policy", () => {
    expect(
      gateResources(retiringBeta())
        .map((resource) => `${resource.kind}/${resource.metadata.name}`)
        .toSorted(),
    ).toEqual(
      [
        `Job/${GATE}`,
        `NetworkPolicy/${GATE}-netpol`,
        `Role/${GATE}`,
        `RoleBinding/${GATE}`,
        `ServiceAccount/${GATE}`,
      ].toSorted(),
    );
  });

  /**
   * Only the rollback needs it. On `split` there is no pod to wait for in the
   * right direction, and on `absent` nothing gateway-shaped is rendered.
   */
  test("no other topology or stage renders any gate resource", () => {
    for (const resources of [
      scoutResourcesWithGatewayTopology("beta", "split"),
      scoutResourcesWithGatewayTopology("beta", "absent"),
      scoutResources("beta"),
      scoutResources("prod"),
    ]) {
      expect(gateResources(resources)).toEqual([]);
    }
  });
});

describe("Scout gateway retirement gate ordering", () => {
  /**
   * The full chain: prerequisites, then the scale-down, then the wait, then
   * the backend. Asserted as strict relations rather than literals so the
   * claim is the ordering, and so an edit that moved the backend into a wave
   * would have to come back here.
   */
  test("sits strictly between the scale-to-zero and the backend", () => {
    const resources = retiringBeta();
    const scaleDown = wave(resources, "Deployment", "scout-beta-scout-gateway");
    const gate = wave(resources, "Job", GATE);
    const backend = wave(resources, "Deployment", "scout-beta-scout-backend");
    expect(scaleDown).toBeLessThan(gate);
    expect(gate).toBeLessThan(backend);
  });

  test("its prerequisites exist before the Job and the scale-down", () => {
    const resources = retiringBeta();
    const scaleDown = wave(resources, "Deployment", "scout-beta-scout-gateway");
    for (const [kind, name] of [
      ["ServiceAccount", GATE],
      ["Role", GATE],
      ["RoleBinding", GATE],
      ["NetworkPolicy", `${GATE}-netpol`],
    ] as const) {
      expect(wave(resources, kind, name)).toBeLessThan(scaleDown);
    }
  });

  /**
   * Only the Job is a hook: recreated on every sync, and ArgoCD blocks the
   * next wave on its completion rather than on its apply. It deletes itself
   * after success and is kept for its logs after a failure.
   */
  test("the Job is a Sync hook at wave -1, deleted after success", () => {
    const metadata = annotations(retiringBeta(), "Job", GATE);
    expect(metadata["argocd.argoproj.io/hook"]).toBe("Sync");
    expect(metadata["argocd.argoproj.io/hook-delete-policy"]).toBe(
      "BeforeHookCreation,HookSucceeded",
    );
    expect(metadata[SYNC_WAVE]).toBe("-1");
  });

  /**
   * The prerequisites are ordinary managed resources in wave -3, not hooks.
   * That orders them before the Job whatever ArgoCD does with hook deletion,
   * and it lets release-root's pruning sync remove them once the stage stops
   * rendering the gate. ArgoCD never prunes hooks, so as hooks they would stay
   * in the namespace after `absent`.
   */
  test("its prerequisites are plain wave -3 resources, not hooks", () => {
    const resources = retiringBeta();
    for (const [kind, name] of [
      ["ServiceAccount", GATE],
      ["Role", GATE],
      ["RoleBinding", GATE],
      ["NetworkPolicy", `${GATE}-netpol`],
    ] as const) {
      const metadata = annotations(resources, kind, name);
      expect(metadata["argocd.argoproj.io/hook"]).toBeUndefined();
      expect(metadata["argocd.argoproj.io/hook-delete-policy"]).toBeUndefined();
      expect(metadata[SYNC_WAVE]).toBe("-3");
    }
  });
});

describe("Scout gateway retirement gate behaviour", () => {
  test("waits for deletion of the gateway's pods and fails on timeout", () => {
    const container = gateJob(retiringBeta()).template.spec.containers[0];
    expect(container?.command).toEqual(["/bin/bash", "-c"]);
    const script = container?.args.join("\n") ?? "";
    expect(script).toContain("set -euo pipefail");
    expect(script).toContain("kubectl wait pod");
    expect(script).toContain("--namespace scout-beta");
    expect(script).toContain(`--selector ${SCOUT_GATEWAY_POD_SELECTOR}`);
    expect(script).toContain("--for=delete");
    expect(script).toMatch(/--timeout=\d+s/v);
  });

  /**
   * The Job must outlive the wait it runs, or the kubelet would kill it
   * before kubectl could report the timeout; and a failure must not retry
   * into the rest of the child-sync budget.
   */
  test("fails loudly: no retry, and a deadline beyond the wait", () => {
    const job = gateJob(retiringBeta());
    const script = job.template.spec.containers[0]?.args.join("\n") ?? "";
    const timeout = Number(
      /--timeout=(?<seconds>\d+)s/v.exec(script)?.groups?.["seconds"],
    );
    expect(job.backoffLimit).toBe(0);
    expect(job.activeDeadlineSeconds).toBeGreaterThan(timeout);
  });

  test("selects the gateway's pods and never its own", () => {
    const resources = retiringBeta();
    const gatewayLabels = GatewayPodLabelsSchema.parse(
      findResource(resources, "Deployment", "scout-beta-scout-gateway").spec,
    ).template.metadata.labels;
    const gateLabels = gateJob(resources).template.metadata.labels;
    expect(selectorMatches(SCOUT_GATEWAY_POD_SELECTOR, gatewayLabels)).toBe(
      true,
    );
    expect(selectorMatches(SCOUT_GATEWAY_POD_SELECTOR, gateLabels)).toBe(false);
  });

  test("uses the catalog's digest-pinned kubectl image", () => {
    const pin = versions["bitnamilegacy/kubectl"];
    expect(pin).toMatch(/@sha256:[0-9a-f]{64}$/v);
    expect(gateJob(retiringBeta()).template.spec.containers[0]?.image).toBe(
      `bitnamilegacy/kubectl:${pin}`,
    );
  });
});

describe("Scout gateway retirement gate privileges", () => {
  /**
   * Least privilege: read pods in this namespace, nothing else. A namespaced
   * Role, never a ClusterRole, and no write verb of any kind.
   */
  test("its Role only reads pods in the stage's namespace", () => {
    const resources = retiringBeta();
    const role = RoleSchema.parse(findResource(resources, "Role", GATE));
    expect(role.metadata.namespace).toBe("scout-beta");
    expect(role.rules).toEqual([
      { apiGroups: [""], resources: ["pods"], verbs: ["get", "list", "watch"] },
    ]);
    expect(
      resources.filter(
        (resource) =>
          (resource.kind === "ClusterRole" ||
            resource.kind === "ClusterRoleBinding") &&
          resource.metadata.name.startsWith(GATE),
      ),
    ).toEqual([]);
  });

  test("binds that Role to the Job's ServiceAccount only", () => {
    const resources = retiringBeta();
    const binding = RoleBindingSchema.parse(
      findResource(resources, "RoleBinding", GATE),
    );
    expect(binding.metadata.namespace).toBe("scout-beta");
    expect(binding.roleRef).toEqual({
      apiGroup: "rbac.authorization.k8s.io",
      kind: "Role",
      name: GATE,
    });
    expect(binding.subjects).toEqual([
      { kind: "ServiceAccount", name: GATE, namespace: "scout-beta" },
    ]);
    const pod = gateJob(resources).template.spec;
    expect(pod.serviceAccountName).toBe(GATE);
    // kubectl needs the projected token; cdk8s-plus defaults this to false.
    expect(pod.automountServiceAccountToken).toBe(true);
  });

  /**
   * No other policy in the namespace selects the gate's pod, so this one is
   * what bounds it: the API server and nothing else, and no ingress at all.
   */
  test("its NetworkPolicy allows only API-server egress", () => {
    const resources = retiringBeta();
    const policy = NetworkPolicySpecSchema.parse(
      findResource(resources, "NetworkPolicy", `${GATE}-netpol`).spec,
    );
    expect(policy.podSelector.matchLabels).toEqual({ app: GATE });
    expect(gateJob(resources).template.metadata.labels).toEqual(
      expect.objectContaining({ app: GATE }),
    );
    expect(policy.policyTypes.toSorted()).toEqual(["Egress", "Ingress"]);
    expect(policy.ingress ?? []).toEqual([]);
    expect(policy.egress).toEqual([
      { ports: [{ port: 6443, protocol: "TCP" }] },
    ]);
  });
});
