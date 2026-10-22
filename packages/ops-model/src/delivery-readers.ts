import { forumNativeObservation } from "./forum/native-observation.ts";

/**
 * Delivery's independent settlement readers (model D5, I2, section 8).
 *
 * Settlement reads a target with a credential the executor does not hold,
 * and never through the ArgoCD server. The Delivery API pod runs as one
 * ServiceAccount and projects a short-lived token of it into one directory
 * per reader; each reader's Role grants exactly the resources it reads.
 * Homelab declares these grants and projections; Delivery and the Minecraft
 * controller read only through them. This is identity policy, never
 * selected release state.
 */

/** The Delivery API pod's ServiceAccount; every reader token is projected from it. */
export const DELIVERY_API_SERVICE_ACCOUNT = {
  namespace: "delivery",
  name: "delivery-forum-observer",
} as const;

const READ = ["get", "list", "watch"] as const;

export type DeliveryReaderRule = {
  readonly apiGroups: readonly string[];
  readonly resources: readonly string[];
  readonly verbs: readonly string[];
};

export type DeliveryKubernetesReader = {
  /** Role and RoleBinding name in every namespace below. */
  readonly name: string;
  /** Where the API pod projects the token and cluster CA. */
  readonly directory: string;
  readonly namespaces: readonly string[];
  readonly rules: readonly DeliveryReaderRule[];
};

/** Readers that call the Kubernetes API server with an API-server-audience token. */
export const DELIVERY_KUBERNETES_READERS = {
  /** Argo Application objects, read without ArgoCD's API (section 8). */
  application: {
    name: "delivery-application-reader",
    directory: "/var/run/delivery-application-reader",
    namespaces: ["argocd"],
    rules: [
      {
        apiGroups: ["argoproj.io"],
        resources: ["applications"],
        verbs: READ,
      },
    ],
  },
  /** The Forum's original runtime: its Pods, claims, release Job and workloads. */
  forumBaseline: {
    name: "delivery-forum-baseline-reader",
    directory: "/var/run/delivery-forum-baseline-reader",
    namespaces: forumNativeObservation.namespaces,
    rules: [
      {
        apiGroups: [""],
        resources: ["pods", "persistentvolumeclaims"],
        verbs: READ,
      },
      {
        apiGroups: ["apps"],
        resources: ["deployments", "replicasets"],
        verbs: READ,
      },
      { apiGroups: ["batch"], resources: ["jobs"], verbs: READ },
    ],
  },
  /**
   * Retained Temporal worker hosts: every Deployment and every
   * `worker-family` Pod in a worker pool's namespace, a superset of its
   * Application tree, so a stray host fails closed.
   */
  workerRecovery: {
    name: "delivery-worker-recovery-reader",
    directory: "/var/run/delivery-worker-recovery-reader",
    namespaces: ["temporal", "scout-beta", "scout-prod"],
    rules: [
      { apiGroups: [""], resources: ["pods"], verbs: READ },
      { apiGroups: ["apps"], resources: ["deployments"], verbs: READ },
    ],
  },
} as const satisfies Record<string, DeliveryKubernetesReader>;

/**
 * The Minecraft controller's recovery report. The API presents a token
 * whose audience is the controller, so it authenticates nowhere else; the
 * controller reviews it (TokenReview) and authorizes this one virtual
 * resource (SubjectAccessReview) before it reads its private journal.
 */
export const DELIVERY_MINECRAFT_REPORT_READER = {
  name: "delivery-minecraft-report-reader",
  directory: "/var/run/delivery-minecraft-report-reader",
  audience: "delivery-tsmc-controller",
  namespace: "delivery-tsmc-controller",
  rule: {
    apiGroups: ["delivery.shepherdjerred.com"],
    resources: ["minecraftrecoveryreports"],
    verbs: ["get"],
  },
} as const;
