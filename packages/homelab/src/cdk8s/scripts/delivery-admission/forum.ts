/** Local extended proof: actual CONNECT admission in a node-free disposable k3s API. */
import { App } from "cdk8s";
import { z } from "zod";
import { createDeliveryChart } from "@shepherdjerred/homelab/cdk8s/src/cdk8s-charts/platform/delivery.ts";
import { forumNativeObservation as recipe } from "@shepherdjerred/ops-model/forum/native-observation.ts";
import { admissionProcessResult } from "./local-process.ts";

const container = z
  .string()
  .regex(/^delivery-forum-admission-proof-[a-z0-9-]+$/u)
  .parse(Bun.argv[2]);
const actor = "system:serviceaccount:delivery:delivery-forum-observer";
async function command(args: string[], input?: unknown) {
  return admissionProcessResult(
    ["docker", "exec", "-i", container, ...args],
    input,
  );
}
async function checked(args: string[], input?: unknown) {
  const result = await command(["kubectl", ...args], input);
  if (result.code !== 0) throw new Error(result.stderr.slice(0, 2000));
  return result.stdout;
}
const nodes = z
  .object({ items: z.array(z.unknown()) })
  .parse(JSON.parse(await checked(["get", "nodes", "-o", "json"])));
if (nodes.items.length > 0)
  throw new Error("Proof refuses a cluster with any workload nodes");
const chart = createDeliveryChart(new App(), {
  image: `docker.io/shepherdjerred/delivery@sha256:${"a".repeat(64)}`,
  serviceItemId: "test-service",
  tailscaleItemId: "test-tailnet",
  forumReaderItemId: "test-reader",
  forumObserverItemId: "test-observer",
});
const resources = z
  .array(
    z
      .object({
        kind: z.string(),
        metadata: z.object({
          name: z.string(),
          namespace: z.string().optional(),
        }),
      })
      .loose(),
  )
  .parse(chart.toJson());
await checked(["apply", "-f", "-"], {
  apiVersion: "v1",
  kind: "List",
  items: [
    ...["delivery", ...recipe.namespaces, "unrelated"].map((name) => ({
      apiVersion: "v1",
      kind: "Namespace",
      metadata: { name },
    })),
    ...resources.filter(
      (item) =>
        [
          "ServiceAccount",
          "Role",
          "RoleBinding",
          "ValidatingAdmissionPolicy",
          "ValidatingAdmissionPolicyBinding",
        ].includes(item.kind) &&
        (item.metadata.name === "delivery-forum-observer" ||
          item.metadata.name === "delivery-forum-observer.sjer.red"),
    ),
  ],
});
// Admission propagation is asynchronous. Poll its own observed status, not a guessed delay.
for (let attempt = 0; attempt < 30; attempt++) {
  const status = z
    .object({
      metadata: z.object({ generation: z.number() }),
      status: z
        .object({
          observedGeneration: z.number(),
          typeChecking: z
            .object({ expressionWarnings: z.array(z.unknown()).optional() })
            .optional(),
        })
        .optional(),
    })
    .parse(
      JSON.parse(
        await checked([
          "get",
          "validatingadmissionpolicy",
          "delivery-forum-observer.sjer.red",
          "-o",
          "json",
        ]),
      ),
    );
  if ((status.status?.typeChecking?.expressionWarnings?.length ?? 0) > 0)
    throw new Error("Forum CONNECT policy has CEL warnings");
  if (status.status?.observedGeneration === status.metadata.generation) break;
  if (attempt === 29) throw new Error("Forum CONNECT policy was not observed");
  await new Promise((resolve) => setTimeout(resolve, 1000));
}
let count = 0;
for (const method of ["POST", "GET"]) {
  for (const [name, namespace, pod, target, argv, options, allow] of [
    [
      "fixed read recipe",
      "storm-forum",
      "storm-forum-web-proof",
      "php",
      recipe.command,
      {},
      true,
    ],
    [
      "shell",
      "storm-forum",
      "storm-forum-web-proof",
      "php",
      ["sh", "-c", "id"],
      {},
      false,
    ],
    [
      "PHP mutation",
      "storm-forum",
      "storm-forum-web-proof",
      "php",
      ["php", "-r", "unlink('/app/forum/.storm-assembly');"],
      {},
      false,
    ],
    [
      "wrong container",
      "storm-forum",
      "storm-forum-web-proof",
      "activities",
      recipe.command,
      {},
      false,
    ],
    [
      "database Pod",
      "storm-forum",
      "storm-forum-database-proof",
      "php",
      recipe.command,
      {},
      false,
    ],
    [
      "stdin",
      "storm-forum",
      "storm-forum-web-proof",
      "php",
      recipe.command,
      { stdin: "true" },
      false,
    ],
    [
      "TTY",
      "storm-forum",
      "storm-forum-web-proof",
      "php",
      recipe.command,
      { tty: "true" },
      false,
    ],
  ] satisfies [
    string,
    string,
    string,
    string,
    string[],
    Record<string, string>,
    boolean,
  ][]) {
    const query = new URLSearchParams({
      container: target,
      stdout: "true",
      stderr: "true",
      ...options,
    });
    for (const part of argv) query.append("command", part);
    const result = await command(
      [
        "kubectl",
        `--as=${actor}`,
        method === "GET" ? "get" : "create",
        "--raw",
        `/api/v1/namespaces/${namespace}/pods/${pod}/exec?${query.toString()}`,
        ...(method === "POST" ? ["-f", "-"] : []),
      ],
      method === "POST" ? {} : undefined,
    );
    if (
      !(allow
        ? result.stderr.includes("(NotFound)")
        : result.stderr.includes("delivery-forum-observer.sjer.red"))
    )
      throw new Error(`${method} ${name}: ${result.stderr.slice(0, 2000)}`);
    count++;
    console.log(`${allow ? "ALLOW" : "DENY"} ${method} ${name}`);
  }
}
for (const [verb, resource, namespace] of [
  ["get", "secrets", "storm-forum"],
  ["create", "pods", "storm-forum"],
  ["get", "pods", "unrelated"],
  ["create", "pods/exec", "unrelated"],
  ["get", "persistentvolumeclaims/unrelated", "storm-forum"],
]) {
  if (verb === undefined || resource === undefined || namespace === undefined)
    throw new Error("Invalid authorization fixture");
  const result = await command([
    "kubectl",
    `--as=${actor}`,
    "auth",
    "can-i",
    verb,
    resource,
    "--namespace",
    namespace,
  ]);
  if (result.stdout.trim() !== "no")
    throw new Error(`Observer gained ${verb} ${resource} in ${namespace}`);
  count++;
  console.log(`DENY RBAC ${verb} ${resource} ${namespace}`);
}
console.log(
  `Verified ${String(count)} actual local API cases; no workloads, production cluster, or installed Forum touched.`,
);
