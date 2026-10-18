import type { Chart } from "cdk8s";
import sandbox from "homelab/src/minecraft-delivery-sandbox.json" with { type: "json" };
import { controllerGuard } from "./minecraft-controller-guards.ts";

const LEASE = "sjer.red/world-restore-lease";
const VALIDATION = "minecraft-tsmc-delivery-validation";
const IMAGE =
  "^docker[.]io/shepherdjerred/the-storm-server:[a-zA-Z0-9_.-]+@sha256:[a-f0-9]{64}$";

/** Field comparisons preserve Kubernetes' typed CEL objects and avoid heterogeneous map literals. */
function recipeMatch(path: string, value: unknown): string {
  // Native OpenAPI omits Quantity-bearing members from these CEL declarations.
  // Keep their exact value checks, using the underlying admission JSON object.
  if (path.endsWith(".resources") || path.endsWith(".emptyDir"))
    path = `dyn(${path})`;
  if (value === "{{requestId}}") return `${path} == variables.requestId`;
  if (value === "{{candidateImage}}") return `${path} == variables.image`;
  if (Array.isArray(value))
    return `(${path}.size() == ${String(value.length)} && ${value.map((entry: unknown, index) => recipeMatch(`${path}[${String(index)}]`, entry)).join(" && ")})`;
  if (typeof value === "object" && value !== null)
    return `(${Object.entries(value)
      .map(
        ([key, entry]: [string, unknown]) =>
          `has(${path}.${key}) && ${recipeMatch(`${path}.${key}`, entry)}`,
      )
      .join(" && ")})`;
  return `${path} == ${JSON.stringify(value)}`;
}

function containerRecipe(
  path: string,
  recipe: Record<string, unknown>,
): string {
  const dangerous = [
    "command",
    "args",
    "env",
    "envFrom",
    "volumeMounts",
    "volumeDevices",
    "ports",
    "lifecycle",
    "livenessProbe",
    "readinessProbe",
    "startupProbe",
    "stdin",
    "stdinOnce",
    "tty",
    "resizePolicy",
    "restartPolicy",
  ];
  return [
    ...Object.entries(recipe).map(([key, value]) =>
      recipeMatch(`${path}.${key}`, value),
    ),
    ...dangerous
      .filter((key) => !(key in recipe))
      .map((key) =>
        ["stdin", "stdinOnce", "tty"].includes(key)
          ? `(!has(${path}.${key}) || ${path}.${key} == false)`
          : `!has(${path}.${key})`,
      ),
    securityBoundary(
      `${path}.securityContext`,
      [
        "runAsUser",
        "runAsGroup",
        "readOnlyRootFilesystem",
        "allowPrivilegeEscalation",
        "capabilities",
      ],
      false,
    ),
  ].join(" && ");
}

function securityBoundary(
  path: string,
  allowed: readonly string[],
  pod: boolean,
): string {
  const fields = pod
    ? [
        "seLinuxOptions",
        "windowsOptions",
        "runAsUser",
        "runAsGroup",
        "runAsNonRoot",
        "supplementalGroups",
        "fsGroup",
        "fsGroupChangePolicy",
        "sysctls",
        "seccompProfile",
        "appArmorProfile",
        "supplementalGroupsPolicy",
        "seLinuxChangePolicy",
      ]
    : [
        "capabilities",
        "privileged",
        "seLinuxOptions",
        "windowsOptions",
        "runAsUser",
        "runAsGroup",
        "runAsNonRoot",
        "readOnlyRootFilesystem",
        "allowPrivilegeEscalation",
        "procMount",
        "seccompProfile",
        "appArmorProfile",
      ];
  return [
    ...fields
      .filter((field) => !allowed.includes(field))
      .map((field) => `!has(${path}.${field})`),
    ...(pod ? [] : [`!has(${path}.capabilities.add)`]),
  ].join(" && ");
}

export function createMinecraftControllerPodGuards(chart: Chart): void {
  const template = sandbox.podTemplate.spec;
  const init = template.initContainers[0];
  const candidate = template.containers[0];
  if (
    init === undefined ||
    candidate === undefined ||
    sandbox.schemaVersion !== 1 ||
    template.initContainers.length !== 1 ||
    template.containers.length !== 1
  )
    throw new Error(
      "Storm admission requires exactly one reviewed candidate and overlay initializer",
    );
  controllerGuard(chart, "pods", {
    group: "",
    version: "v1",
    resources: ["pods"],
    operations: ["CREATE"],
    variables: [
      { name: "requestId", expression: `object.metadata.labels['${LEASE}']` },
      { name: "image", expression: "object.spec.containers[0].image" },
      {
        name: "reader",
        expression:
          "object.metadata.name == 'storm-verify-reader-' + variables.requestId",
      },
      {
        name: "candidate",
        expression:
          "object.metadata.name == 'storm-candidate-' + variables.requestId",
      },
    ],
    expressions: [
      `variables.requestId.matches('^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$') && variables.image.matches('${IMAGE}')`,
      `request.namespace in ['minecraft-tsmc', '${VALIDATION}'] && (variables.reader || (request.namespace == '${VALIDATION}' && variables.candidate))`,
      "object.spec.automountServiceAccountToken == false && object.spec.serviceAccountName == 'default' && object.spec.enableServiceLinks == false && object.spec.restartPolicy == 'Never' && object.spec.containers.size() == 1",
      "(!has(object.spec.hostNetwork) || !object.spec.hostNetwork) && (!has(object.spec.hostPID) || !object.spec.hostPID) && (!has(object.spec.hostIPC) || !object.spec.hostIPC) && (!has(object.spec.shareProcessNamespace) || !object.spec.shareProcessNamespace) && !has(object.spec.ephemeralContainers)",
      "object.spec.imagePullSecrets.size() == 1 && object.spec.imagePullSecrets[0].name == 'dockerhub-pull-' + request.namespace",
      "!has(object.metadata.ownerReferences) && !has(object.metadata.finalizers)",
      `!variables.candidate || (${securityBoundary("object.spec.securityContext", ["fsGroup", "runAsNonRoot", "seccompProfile"], true)})`,
      `!variables.reader || (${securityBoundary("object.spec.securityContext", ["runAsNonRoot", "seccompProfile"], true)} && ${securityBoundary("object.spec.containers[0].securityContext", ["runAsUser", "runAsGroup", "readOnlyRootFilesystem", "allowPrivilegeEscalation", "capabilities"], false)})`,
      "!variables.reader || (!has(object.spec.containers[0].lifecycle) && !has(object.spec.containers[0].livenessProbe) && !has(object.spec.containers[0].readinessProbe) && !has(object.spec.containers[0].startupProbe) && !has(object.spec.containers[0].ports) && !has(object.spec.containers[0].volumeDevices) && object.spec.containers[0].securityContext.runAsUser == 1000 && object.spec.containers[0].securityContext.runAsGroup == 2000)",
      `!variables.reader || (${recipeMatch("object.spec.volumes", [{ name: "data", persistentVolumeClaim: { claimName: "datadir-minecraft-tsmc-0", readOnly: true } }])} && (!has(object.spec.initContainers) || object.spec.initContainers.size() == 0) && object.spec.containers[0].name == 'reader' && object.spec.containers[0].command == ['sleep','infinity'] && !has(object.spec.containers[0].args) && !has(object.spec.containers[0].env) && !has(object.spec.containers[0].envFrom) && ${recipeMatch("object.spec.containers[0].volumeMounts", [{ name: "data", mountPath: "/data", readOnly: true }])} && object.spec.containers[0].securityContext.readOnlyRootFilesystem == true && object.spec.containers[0].securityContext.allowPrivilegeEscalation == false && object.spec.containers[0].securityContext.capabilities.drop == ['ALL'] && !has(object.spec.containers[0].securityContext.capabilities.add))`,
      `!variables.candidate || (${recipeMatch("object.spec.volumes", template.volumes)} && object.spec.activeDeadlineSeconds == 1200 && object.spec.terminationGracePeriodSeconds == 120 && ${recipeMatch("object.spec.securityContext", template.securityContext)} && object.spec.initContainers.size() == 1 && ${containerRecipe("object.spec.initContainers[0]", init)} && ${containerRecipe("object.spec.containers[0]", candidate)})`,
    ],
  });
  controllerGuard(chart, "pod-delete", {
    group: "",
    version: "v1",
    resources: ["pods"],
    operations: ["DELETE"],
    expressions: [
      `has(oldObject.metadata.labels) && '${LEASE}' in oldObject.metadata.labels && (request.name == 'storm-verify-reader-' + oldObject.metadata.labels['${LEASE}'] || (request.namespace == '${VALIDATION}' && request.name == 'storm-candidate-' + oldObject.metadata.labels['${LEASE}']))`,
      // Pod deletion can first mark the same incarnation for graceful deletion,
      // advancing its RV before DELETE admission runs again. The API storage
      // layer enforces the caller's original RV; require that precondition, but
      // do not compare it to the later graceful-delete incarnation's new RV.
      "has(request.options.preconditions) && request.options.preconditions.uid == oldObject.metadata.uid && has(request.options.preconditions.resourceVersion) && request.options.preconditions.resourceVersion.size() > 0",
    ],
  });
  // CONNECT receives PodExecOptions as object, not request.options. Production
  // admits only player-count RCON and fixed read-only tar invocations, never a shell.
  controllerGuard(chart, "exec", {
    group: "",
    version: "v1",
    resources: ["pods/exec"],
    operations: ["CONNECT"],
    expressions: [
      `request.namespace == '${VALIDATION}' || (request.namespace == 'minecraft-tsmc' && (!has(object.stdin) || !object.stdin) && ((request.name == 'minecraft-tsmc-0' && object.container == 'minecraft-tsmc' && object.command == ['rcon-cli','minecraft:list']) || (request.name.matches('^storm-verify-reader-[a-f0-9-]{36}$') && object.container == 'reader' && (object.command == ['tar','-C','/data','-cf','-','.'] || object.command == ['tar','--exclude=./.storm-restoration','-C','/data','-cf','-','.']))))`,
      "!has(object.tty) || !object.tty",
    ],
  });
}
