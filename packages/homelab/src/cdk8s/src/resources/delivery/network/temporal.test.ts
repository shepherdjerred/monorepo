import { App } from "cdk8s";
import { beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { createTemporalChart } from "@shepherdjerred/homelab/cdk8s/src/cdk8s-charts/platform/temporal.ts";
import { createDeliveryChart } from "@shepherdjerred/homelab/cdk8s/src/cdk8s-charts/platform/delivery.ts";
import { createDeliveryControlPlaneChart } from "@shepherdjerred/homelab/cdk8s/src/cdk8s-charts/platform/delivery-control-plane.ts";
import { podTemplateSchema } from "@shepherdjerred/homelab/cdk8s/src/testing/pod-template-schema.ts";

const Selector = z.object({
  matchLabels: z.record(z.string(), z.string()).optional(),
  matchExpressions: z
    .array(
      z.object({
        key: z.string(),
        operator: z.literal("In"),
        values: z.array(z.string()),
      }),
    )
    .optional(),
});
const Peer = z.object({
  namespaceSelector: Selector.optional(),
  podSelector: Selector.optional(),
});
const Rule = z.object({
  from: z.array(Peer).optional(),
  to: z.array(Peer).optional(),
  ports: z
    .array(z.object({ port: z.number(), protocol: z.string().default("TCP") }))
    .optional(),
});
const Policy = z.object({
  kind: z.literal("NetworkPolicy"),
  metadata: z.object({ name: z.string(), namespace: z.string() }),
  spec: z.object({
    podSelector: Selector,
    ingress: z.array(Rule).optional(),
    egress: z.array(Rule).optional(),
  }),
});
const Workload = z.object({
  kind: z.enum(["Deployment", "Job"]),
  metadata: z.object({ name: z.string(), namespace: z.string() }),
  spec: z.object({
    template: podTemplateSchema(
      z.object({
        env: z
          .array(z.object({ name: z.string(), value: z.string().optional() }))
          .default([]),
      }),
    ),
  }),
});
type Client = { namespace: string; labels: Record<string, string> };
type NetworkPolicy = z.infer<typeof Policy>;

function matches(
  selector: z.infer<typeof Selector> | undefined,
  labels: Record<string, string>,
) {
  return (
    Object.entries(selector?.matchLabels ?? {}).every(
      ([key, value]) => labels[key] === value,
    ) &&
    (selector?.matchExpressions ?? []).every(({ key, values }) =>
      values.includes(labels[key] ?? ""),
    )
  );
}
function peerMatches(
  peer: z.infer<typeof Peer>,
  source: Client,
  policyNamespace: string,
) {
  return (
    (peer.namespaceSelector === undefined
      ? source.namespace === policyNamespace
      : matches(peer.namespaceSelector, {
          "kubernetes.io/metadata.name": source.namespace,
        })) && matches(peer.podSelector, source.labels)
  );
}
function allows(
  policy: NetworkPolicy,
  source: Client,
  port: number,
  protocol = "TCP",
) {
  return (policy.spec.ingress ?? []).some(
    (rule) =>
      (rule.ports === undefined ||
        rule.ports.some(
          (entry) => entry.port === port && entry.protocol === protocol,
        )) &&
      (rule.from === undefined ||
        rule.from.some((peer) =>
          peerMatches(peer, source, policy.metadata.namespace),
        )),
  );
}
function client(workload: z.infer<typeof Workload>): Client {
  return {
    namespace: workload.metadata.namespace,
    labels: workload.spec.template.metadata.labels,
  };
}
function portsAreClosed(policy: NetworkPolicy, source: Client) {
  for (const port of [443, 7234, 8080, 9090, 9464, 9465, 17_233])
    expect(allows(policy, source, port)).toBe(false);
  expect(allows(policy, source, 7233, "UDP")).toBe(false);
}

const app = new App();
createTemporalChart(app);
const controlPlane = createDeliveryControlPlaneChart(app, {
  image: `docker.io/shepherdjerred/delivery@sha256:${"a".repeat(64)}`,
  serviceItemId: "service-item",
  executorItemId: "executor-item",
  argocdItemId: "argo-item",
  workerRegistryItemId: "worker-registry-item",
  platformRegistryItemId: "platform-registry-item",
  platformArgocdItemId: "platform-argo-item",
});
const api = createDeliveryChart(app, {
  image: `docker.io/shepherdjerred/delivery@sha256:${"a".repeat(64)}`,
  serviceItemId: "service-item",
});
const policies = app.charts
  .flatMap((chart) => chart.toJson())
  .flatMap((raw) => {
    const result = Policy.safeParse(raw);
    return result.success ? [result.data] : [];
  });
const server = policies.find(
  (policy) => policy.metadata.name === "temporal-server-netpol",
);
if (server === undefined)
  throw new Error("Missing actual Temporal server policy");
const workloads = controlPlane.toJson().flatMap((raw) => {
  const result = Workload.safeParse(raw);
  return result.success ? [result.data] : [];
});
let jobs: z.infer<typeof Workload>[];

beforeAll(() => {
  // Call the real native Job producer in its owning workspace. CDK does not
  // depend on Temporal's SDK or duplicate the Job's namespace/Pod recipe.
  const produced = Bun.spawnSync(
    [
      "bun",
      "-e",
      `
    import {deliveryJobManifest} from "./src/lib/delivery/job-manifest.ts";
    import {DeliveryJobRequestSchema} from "./src/shared/delivery-job.ts";
    const jobs = DeliveryJobRequestSchema.shape.recipe.options.map(recipe => deliveryJobManifest({
      deploymentId:"network-proof", stageKey:recipe, recipe,
      runnerImage:"docker.io/shepherdjerred/ci-base@sha256:"+"a".repeat(64), sourceRevision:"b".repeat(40),
      input:recipe === "platform-recovery" ? {intentId:"network-proof",action:"inspect",attempt:1,
        expectedEnvironmentGeneration:1,snapshotFingerprint:"c".repeat(64),target:"control-plane"} : {stack:"github"},
    }));
    console.log(JSON.stringify(jobs));
  `,
    ],
    {
      cwd: new URL("../temporal/", import.meta.resolve("homelab/package.json"))
        .pathname,
      stdout: "pipe",
      stderr: "pipe",
      timeout: 10_000,
      env: Object.fromEntries(
        Object.entries(Bun.env).filter(
          ([key]) => key !== "OP_SERVICE_ACCOUNT_TOKEN",
        ),
      ),
    },
  );
  expect(produced.exitCode, produced.stderr.toString()).toBe(0);
  jobs = z.array(Workload).parse(JSON.parse(produced.stdout.toString()));
});

describe("actual Delivery client reachability to Temporal", () => {
  it("admits all three independently released pollers on gRPC only with their exact Kubernetes namespace", () => {
    expect(
      workloads
        .map((item) =>
          z.string().parse(item.spec.template.metadata.labels["component"]),
        )
        .sort((left, right) => left.localeCompare(right)),
    ).toEqual([
      "delivery-platform-worker",
      "delivery-worker",
      "delivery-workflows",
    ]);
    for (const workload of workloads) {
      const source = client(workload);
      expect(source.namespace).toBe("temporal");
      expect(
        workload.spec.template.spec.containers.flatMap(
          (container) => container.env,
        ),
      ).toEqual(
        expect.arrayContaining([
          {
            name: "TEMPORAL_ADDRESS",
            value: "temporal-temporal-server-service:7233",
          },
          { name: "TEMPORAL_NAMESPACE", value: "prod" },
        ]),
      );
      expect(allows(server, source, 7233)).toBe(true);
      portsAreClosed(server, source);
      for (const namespace of [
        "default",
        "delivery",
        "delivery-worker-jobs",
        "delivery-platform-jobs",
      ]) {
        expect(allows(server, { ...source, namespace }, 7233)).toBe(false);
      }
      expect(
        allows(
          server,
          { ...source, labels: { component: "delivery-unknown" } },
          7233,
        ),
      ).toBe(false);
    }
  });

  it("admits all real native stage recipes only from the two source-owned Job namespaces", () => {
    expect(jobs).toHaveLength(8);
    expect(new Set(jobs.map((job) => job.metadata.namespace))).toEqual(
      new Set(["delivery-worker-jobs", "delivery-platform-jobs"]),
    );
    for (const job of jobs) {
      const source = client(job);
      expect(source.labels).toEqual({ app: "delivery-stage" });
      expect(allows(server, source, 7233)).toBe(true);
      portsAreClosed(server, source);
      expect(
        allows(server, { ...source, labels: { app: "unrelated-job" } }, 7233),
      ).toBe(false);
      for (const namespace of [
        "temporal",
        "delivery",
        "default",
        "woodpecker-ci",
      ]) {
        expect(allows(server, { ...source, namespace }, 7233)).toBe(false);
      }
    }
  });

  it("pairs ingress with actual producer egress and grants no Temporal access to the HTTP-only API", () => {
    for (const workload of [...workloads, ...jobs]) {
      const source = client(workload);
      const matching = policies.filter(
        (policy) =>
          policy.metadata.namespace === source.namespace &&
          matches(policy.spec.podSelector, source.labels),
      );
      expect(
        matching.some((policy) =>
          (policy.spec.egress ?? []).some(
            (rule) =>
              rule.ports?.some(
                (entry) => entry.port === 7233 && entry.protocol === "TCP",
              ) &&
              rule.to?.some((peer) =>
                peerMatches(
                  peer,
                  { namespace: "temporal", labels: { app: "temporal-server" } },
                  policy.metadata.namespace,
                ),
              ),
          ),
        ),
      ).toBe(true);
    }
    const apiPods = api.toJson().flatMap((raw) => {
      const result = Workload.safeParse(raw);
      return result.success && result.data.kind === "Deployment"
        ? [result.data]
        : [];
    });
    expect(apiPods).toHaveLength(1);
    for (const pod of apiPods) {
      expect(allows(server, client(pod), 7233)).toBe(false);
      expect(
        pod.spec.template.spec.containers
          .flatMap((container) => container.env)
          .some((entry) => entry.name === "TEMPORAL_ADDRESS"),
      ).toBe(false);
    }
  });
});
