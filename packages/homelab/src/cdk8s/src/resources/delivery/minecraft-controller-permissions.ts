import { ApiObject, type Chart } from "cdk8s";
import {
  DELIVERY_API_SERVICE_ACCOUNT,
  DELIVERY_MINECRAFT_REPORT_READER as report,
} from "@shepherdjerred/ops-model/delivery-readers.ts";

const CONTROLLER = "delivery-tsmc-controller";
const VALIDATION = "minecraft-tsmc-delivery-validation";
const SERVER = "minecraft-tsmc";
const ROUTES = [
  SERVER,
  `${SERVER}-bedrock`,
  `${SERVER}-bluemap`,
  `${SERVER}-rcon`,
];
const GUARDS = [
  "",
  "-scale",
  "-delete",
  "-service-write",
  "-service-delete",
].map((suffix) => `${SERVER}-world-restoration${suffix}.sjer.red`);
type Rule = {
  apiGroups: string[];
  resources: string[];
  verbs: string[];
  resourceNames?: string[];
};

function role(chart: Chart, namespace: string, rules: Rule[]): void {
  new ApiObject(chart, `${CONTROLLER}-${namespace}-role`, {
    apiVersion: "rbac.authorization.k8s.io/v1",
    kind: "Role",
    metadata: { name: CONTROLLER, namespace },
    rules,
  });
  new ApiObject(chart, `${CONTROLLER}-${namespace}-binding`, {
    apiVersion: "rbac.authorization.k8s.io/v1",
    kind: "RoleBinding",
    metadata: { name: CONTROLLER, namespace },
    roleRef: {
      apiGroup: "rbac.authorization.k8s.io",
      kind: "Role",
      name: CONTROLLER,
    },
    subjects: [
      { kind: "ServiceAccount", name: CONTROLLER, namespace: CONTROLLER },
    ],
  });
}

/**
 * `delivery-minecraft-report-reader`: the Delivery API may read a recovery
 * report, and nothing else, with a token whose audience is this controller.
 * The controller checks the grant with a SubjectAccessReview.
 */
function createReportReader(chart: Chart): void {
  new ApiObject(chart, `${report.name}-role`, {
    apiVersion: "rbac.authorization.k8s.io/v1",
    kind: "Role",
    metadata: { name: report.name, namespace: report.namespace },
    rules: [
      {
        apiGroups: [...report.rule.apiGroups],
        resources: [...report.rule.resources],
        verbs: [...report.rule.verbs],
      },
    ],
  });
  new ApiObject(chart, `${report.name}-binding`, {
    apiVersion: "rbac.authorization.k8s.io/v1",
    kind: "RoleBinding",
    metadata: { name: report.name, namespace: report.namespace },
    roleRef: {
      apiGroup: "rbac.authorization.k8s.io",
      kind: "Role",
      name: report.name,
    },
    subjects: [{ kind: "ServiceAccount", ...DELIVERY_API_SERVICE_ACCOUNT }],
  });
}

/** Named target grants plus admission fences for operations RBAC cannot restrict by body. */
export function createMinecraftControllerPermissions(chart: Chart): void {
  createReportReader(chart);
  role(chart, CONTROLLER, [
    {
      apiGroups: [""],
      resources: ["pods"],
      verbs: ["get"],
      resourceNames: [`${CONTROLLER}-0`],
    },
  ]);
  role(chart, SERVER, [
    {
      apiGroups: ["apps"],
      resources: ["statefulsets"],
      verbs: ["get", "patch", "delete"],
      resourceNames: [SERVER],
    },
    {
      apiGroups: ["apps"],
      resources: ["statefulsets/scale"],
      verbs: ["get", "patch", "update"],
      resourceNames: [SERVER],
    },
    {
      apiGroups: [""],
      resources: ["services"],
      verbs: ["get", "patch", "delete"],
      resourceNames: ROUTES,
    },
    {
      apiGroups: [""],
      resources: ["persistentvolumeclaims"],
      verbs: ["get", "list"],
    },
    {
      apiGroups: [""],
      resources: ["pods"],
      verbs: ["get", "list", "watch", "create", "delete"],
    },
    { apiGroups: [""], resources: ["pods/exec"], verbs: ["get", "create"] },
    {
      apiGroups: ["onepassword.com"],
      resources: ["onepassworditems"],
      verbs: ["get"],
      resourceNames: [`dockerhub-pull-${SERVER}`],
    },
  ]);
  role(chart, VALIDATION, [
    {
      apiGroups: [""],
      resources: ["pods"],
      verbs: ["get", "list", "watch", "create", "delete"],
    },
    { apiGroups: [""], resources: ["pods/log"], verbs: ["get"] },
    { apiGroups: [""], resources: ["pods/exec"], verbs: ["get", "create"] },
    {
      apiGroups: [""],
      resources: ["persistentvolumeclaims"],
      verbs: ["get", "list", "watch", "delete"],
      resourceNames: ["datadir-minecraft-tsmc-0"],
    },
    {
      apiGroups: ["onepassword.com"],
      resources: ["onepassworditems"],
      verbs: ["get", "list", "watch"],
      resourceNames: [`dockerhub-pull-${VALIDATION}`],
    },
  ]);
  role(chart, "argocd", [
    {
      apiGroups: ["argoproj.io"],
      resources: ["applications"],
      verbs: ["get"],
      resourceNames: [SERVER],
    },
  ]);
  role(chart, "velero", [
    {
      apiGroups: ["velero.io"],
      resources: ["backups", "restores"],
      verbs: ["get", "create"],
    },
  ]);
  role(chart, "openebs", [
    {
      apiGroups: ["zfs.openebs.io"],
      resources: ["zfsvolumes"],
      verbs: ["get", "list", "watch"],
    },
  ]);
  new ApiObject(chart, `${CONTROLLER}-inspection-role`, {
    apiVersion: "rbac.authorization.k8s.io/v1",
    kind: "ClusterRole",
    metadata: { name: CONTROLLER, namespace: "" },
    rules: [
      {
        apiGroups: [""],
        resources: ["namespaces"],
        verbs: ["get"],
        resourceNames: [VALIDATION],
      },
      {
        apiGroups: [""],
        resources: ["persistentvolumes"],
        verbs: ["get", "list", "watch", "patch"],
      },
      {
        apiGroups: ["storage.k8s.io"],
        resources: ["volumeattachments"],
        verbs: ["get", "list"],
      },
      {
        apiGroups: ["admissionregistration.k8s.io"],
        resources: [
          "validatingadmissionpolicies",
          "validatingadmissionpolicybindings",
        ],
        verbs: ["get"],
        resourceNames: GUARDS,
      },
      // Authenticate and authorize the API's report reader (D5, I2).
      {
        apiGroups: ["authentication.k8s.io"],
        resources: ["tokenreviews"],
        verbs: ["create"],
      },
      {
        apiGroups: ["authorization.k8s.io"],
        resources: ["subjectaccessreviews"],
        verbs: ["create"],
      },
    ],
  });
  new ApiObject(chart, `${CONTROLLER}-inspection-binding`, {
    apiVersion: "rbac.authorization.k8s.io/v1",
    kind: "ClusterRoleBinding",
    metadata: { name: CONTROLLER, namespace: "" },
    roleRef: {
      apiGroup: "rbac.authorization.k8s.io",
      kind: "ClusterRole",
      name: CONTROLLER,
    },
    subjects: [
      { kind: "ServiceAccount", name: CONTROLLER, namespace: CONTROLLER },
    ],
  });
}
