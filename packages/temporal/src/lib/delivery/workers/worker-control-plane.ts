import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { quantityToScalar } from "@kubernetes/client-node/dist/util.js";
import { z } from "zod";
import { canonicalJson } from "homelab/scripts/canonical-json.ts";
import { DeliverySelectionSchema } from "homelab/scripts/argocd/argocd-delivery.ts";
import { ArtifactVersionSchema } from "@shepherdjerred/delivery/contract";
import type { RolloutCommandRunner } from "#lib/worker-deployment-proofs.ts";

const components = new Set([
  "delivery-worker",
  "delivery-platform-worker",
  "delivery-workflows",
]);
export const ControlPlaneTemplatesSchema = z.array(
  z.strictObject({
    kind: z.enum(["Deployment", "StatefulSet"]),
    name: z.string(),
    namespace: z.string(),
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
  }),
);
export const WorkerChartProofSchema = z.strictObject({
  selection: DeliverySelectionSchema,
  chart: ArtifactVersionSchema,
});
const object = z.record(z.string(), z.unknown());

function withoutDefaults(
  raw: unknown,
  defaults: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(object.parse(raw)).filter(
      ([key, value]) =>
        !Object.hasOwn(defaults, key) ||
        canonicalJson(value) !== canonicalJson(defaults[key]),
    ),
  );
}
function normalizedQuantity(raw: unknown): string {
  const quantity = z.string().min(1).parse(raw);
  const scalar = quantityToScalar(quantity);
  if (
    (typeof scalar === "number" &&
      (!Number.isFinite(scalar) ||
        Math.abs(scalar) > Number.MAX_SAFE_INTEGER)) ||
    scalar < 0
  )
    throw new Error("Control-plane resource quantity is not finite and safe");
  return scalar.toString();
}

function normalizedResources(raw: unknown): Record<string, unknown> {
  const resources = object.parse(raw);
  for (const field of ["requests", "limits"]) {
    if (resources[field] === undefined) continue;
    const quantities = object.parse(resources[field]);
    for (const resource of ["cpu", "memory"])
      if (quantities[resource] !== undefined)
        quantities[resource] = normalizedQuantity(quantities[resource]);
    resources[field] = quantities;
  }
  return resources;
}

/** Only API defaults and equivalent resource quantities are normalized; unknown fields stay exact. */
function normalizedTemplate(raw: unknown): unknown {
  const template = object.parse(structuredClone(raw));
  template["metadata"] = withoutDefaults(template["metadata"], {
    creationTimestamp: null,
  });
  const pod = withoutDefaults(template["spec"], {
    restartPolicy: "Always",
    dnsPolicy: "ClusterFirst",
    schedulerName: "default-scheduler",
    terminationGracePeriodSeconds: 30,
    enableServiceLinks: true,
    securityContext: {},
    hostNetwork: false,
    serviceAccountName: "default",
    serviceAccount: "default",
  });
  if (pod["serviceAccount"] === pod["serviceAccountName"])
    delete pod["serviceAccount"];
  for (const field of ["containers", "initContainers"]) {
    if (pod[field] === undefined) continue;
    pod[field] = z
      .array(object)
      .parse(pod[field])
      .map((rawContainer) => {
        const container = withoutDefaults(rawContainer, {
          imagePullPolicy: "IfNotPresent",
          terminationMessagePath: "/dev/termination-log",
          terminationMessagePolicy: "File",
          resources: {},
        });
        if (container["resources"] !== undefined)
          container["resources"] = normalizedResources(container["resources"]);
        for (const probe of [
          "livenessProbe",
          "readinessProbe",
          "startupProbe",
        ]) {
          if (container[probe] === undefined) continue;
          const check = withoutDefaults(container[probe], {
            timeoutSeconds: 1,
            periodSeconds: 10,
            successThreshold: 1,
            failureThreshold: 3,
          });
          if (check["httpGet"] !== undefined)
            check["httpGet"] = withoutDefaults(check["httpGet"], {
              scheme: "HTTP",
            });
          container[probe] = check;
        }
        if (container["ports"] !== undefined)
          container["ports"] = z
            .array(object)
            .parse(container["ports"])
            .map((port) => withoutDefaults(port, { protocol: "TCP" }));
        return container;
      });
  }
  if (pod["volumes"] !== undefined)
    pod["volumes"] = z
      .array(object)
      .parse(pod["volumes"])
      .map((volume) => {
        for (const field of ["secret", "configMap"])
          if (volume[field] !== undefined)
            volume[field] = withoutDefaults(volume[field], {
              defaultMode: 420,
            });
        return volume;
      });
  template["spec"] = pod;
  return template;
}

export function controlPlaneTemplates(inputs: unknown[]) {
  const result = [];
  for (const input of inputs) {
    const identity = z.object({ kind: z.string() }).parse(input);
    if (!["Deployment", "StatefulSet"].includes(identity.kind)) continue;
    const resource = z
      .object({
        kind: z.enum(["Deployment", "StatefulSet"]),
        metadata: z.object({
          name: z.string(),
          namespace: z.string().default("temporal"),
        }),
        spec: z.object({
          template: z
            .object({
              metadata: z
                .object({ labels: z.record(z.string(), z.string()) })
                .loose(),
            })
            .loose(),
        }),
      })
      .parse(input);
    if (
      !components.has(resource.spec.template.metadata.labels["component"] ?? "")
    )
      continue;
    result.push({
      kind: resource.kind,
      name: resource.metadata.name,
      namespace: resource.metadata.namespace,
      fingerprint: createHash("sha256")
        .update(canonicalJson(normalizedTemplate(resource.spec.template)))
        .digest("hex"),
    });
  }
  return ControlPlaneTemplatesSchema.parse(
    result.sort((a, b) =>
      `${a.namespace}/${a.name}`.localeCompare(`${b.namespace}/${b.name}`),
    ),
  );
}

export function requireIsolatedControlPlane(templates: unknown): void {
  if (ControlPlaneTemplatesSchema.parse(templates).length > 0)
    throw new Error(
      "Historical central chart contains Delivery control-plane workloads; select a split application chart",
    );
}
export function requireControlPlaneReplicas(
  expected: unknown[],
  actual: unknown[],
  dispatchPaused = false,
) {
  const schema = z.object({
    kind: z.string(),
    metadata: z.object({ name: z.string() }),
    spec: z.object({ replicas: z.number().int().default(1) }),
  });
  for (const raw of expected) {
    const kind = z.object({ kind: z.string() }).parse(raw).kind;
    if (!["Deployment", "StatefulSet"].includes(kind)) continue;
    const desired = schema.parse(raw);
    const observed = actual
      .map((value) => schema.parse(value))
      .find(
        (value) =>
          value.kind === desired.kind &&
          value.metadata.name === desired.metadata.name,
      );
    const count =
      dispatchPaused && desired.metadata.name === "temporal-delivery-worker"
        ? 0
        : desired.spec.replicas;
    if (observed?.spec.replicas !== count)
      throw new Error(
        "Control-plane native replicas differ from the exact chart or owned dispatch barrier",
      );
  }
}

export function requireControlPlanePodCoverage(
  manifests: unknown[],
  pods: unknown[],
) {
  const observed = new Set(
    pods.map(
      (pod) =>
        z
          .object({
            metadata: z.object({
              labels: z.record(z.string(), z.string()).default({}),
            }),
          })
          .parse(pod).metadata.labels["component"],
    ),
  );
  for (const raw of manifests) {
    const kind = z.object({ kind: z.string() }).parse(raw).kind;
    if (!["Deployment", "StatefulSet"].includes(kind)) continue;
    const workload = z
      .object({
        spec: z.object({
          replicas: z.number().default(1),
          template: z.object({
            metadata: z.object({ labels: z.record(z.string(), z.string()) }),
          }),
        }),
      })
      .parse(raw);
    const component = workload.spec.template.metadata.labels["component"];
    if (
      component !== undefined &&
      components.has(component) &&
      workload.spec.replicas > 0 &&
      !observed.has(component)
    )
      throw new Error(
        "A selected control-plane role lacks its independently observed native Pod",
      );
  }
}

export function requireUnchangedControlPlane(
  expected: unknown,
  live: unknown[],
): void {
  const selected = ControlPlaneTemplatesSchema.parse(expected);
  const actual = controlPlaneTemplates(live);
  if (
    selected.length === 0 ||
    canonicalJson(selected) !== canonicalJson(actual)
  )
    throw new Error(
      "Ordinary worker release would change a live Delivery control-plane Pod template",
    );
}

export async function renderWorkerChart(
  raw: unknown,
  run: RolloutCommandRunner,
) {
  const { selection, chart } = WorkerChartProofSchema.parse(raw);
  const response = await fetch(chart.uri, {
    signal: AbortSignal.timeout(30_000),
    redirect: "error",
  });
  if (!response.ok) throw new Error("Control-plane chart read failed");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (
    `sha256:${createHash("sha256").update(bytes).digest("hex")}` !==
    chart.digest
  )
    throw new Error("Control-plane chart bytes differ from frozen artifact");
  const directory = await mkdtemp(
    path.join(tmpdir(), "delivery-control-plane-"),
  );
  try {
    const archive = path.join(directory, "chart.tgz"),
      values = path.join(directory, "values.json");
    await Bun.write(archive, bytes);
    const configured: Record<string, unknown> = {};
    for (const [parameter, value] of Object.entries(selection.parameters)) {
      if (!/^[\w-]+(?:\.[\w-]+)*$/u.test(parameter))
        throw new Error(
          "Control-plane chart parameter has unsupported path syntax",
        );
      const keys = parameter.split(".");
      if (
        keys.some((key) =>
          ["__proto__", "constructor", "prototype"].includes(key),
        )
      )
        throw new Error(
          "Control-plane chart parameter has an unsafe object path",
        );
      let target = configured;
      for (const key of keys.slice(0, -1)) {
        const nested = object.parse(target[key] ?? {});
        target[key] = nested;
        target = nested;
      }
      target[z.string().min(1).parse(keys.at(-1))] = value;
    }
    await Bun.write(values, JSON.stringify(configured));
    const result = await run([
      "helm",
      "template",
      selection.application,
      archive,
      "--namespace",
      selection.namespace ?? "temporal",
      "--values",
      values,
    ]);
    // Helm emits YAML document separators at column zero; block scalar contents stay indented.
    const manifests = result.stdout
      .split(/^---[\t ]*$/mu)
      .filter((document) => document.trim().length > 0)
      .map((document) => Bun.YAML.parse(document))
      .filter((document) => document !== null);
    return manifests;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export async function renderControlPlaneTemplates(
  raw: unknown,
  run: RolloutCommandRunner,
) {
  return controlPlaneTemplates(await renderWorkerChart(raw, run));
}
