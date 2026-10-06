/**
 * The pod for one cluster sandbox. Pure, so every constraint the mc-sandbox
 * admission policy enforces (packages/homelab mc-sandbox chart) is asserted in
 * tests: harness labels and TTL annotation, a hard activeDeadlineSeconds,
 * batch-low priority on the CI node, bounded requests and limits on every
 * container, emptyDir-only volumes, Pod Security "restricted", and images
 * pinned by digest.
 */
import type { ResolvedProfile } from "#sandbox/profiles.ts";
import { pluginMountTargets, stagesPlugins } from "#sandbox/profiles.ts";

export const MANAGED_BY_LABEL = "app.kubernetes.io/managed-by";
export const MANAGED_BY_VALUE = "mc-harness";
export const SANDBOX_LABEL = "mc-harness.sjer.red/sandbox";
export const PROFILE_LABEL = "mc-harness.sjer.red/profile";
export const EXPIRES_AT_ANNOTATION = "mc-harness.sjer.red/expires-at";
export const KEEP_ANNOTATION = "mc-harness.sjer.red/keep";
export const OWNER_ANNOTATION = "mc-harness.sjer.red/owner";

/** Upper bound the admission policy accepts for activeDeadlineSeconds (8 h). */
export const MAX_ACTIVE_DEADLINE_SECONDS = 28_800;
/** Grace past the sandbox TTL before the kubelet kills the pod outright. */
const DEADLINE_GRACE_SECONDS = 600;

/** CI node placement and toleration (packages/homelab misc/nodes.ts). */
export const CI_NODE_HOSTNAME = "liskov";
export const CI_NODE_TOLERATION = {
  key: "ci",
  operator: "Equal",
  value: "only",
  effect: "NoSchedule",
} as const;
export const SANDBOX_PRIORITY_CLASS = "batch-low";

export const MAIN_CONTAINER = "minecraft";
export const STAGE_CONTAINER = "stage";
/** Mount point of the staging emptyDir in the stage init container. */
export const STAGING_DIR = "/staging";
/** File the provider touches once staging is copied in. */
export const STAGING_READY = `${STAGING_DIR}/.ready`;

const PORT_NAMES: Readonly<Record<number, string>> = {
  25_565: "game",
  25_575: "rcon",
  25_580: "bridge",
};

export function sandboxPodName(id: string): string {
  return `mc-harness-${id}`;
}

export type SandboxPodOptions = {
  id: string;
  profileName: string;
  profile: ResolvedProfile;
  /** Sandbox TTL; the pod deadline is TTL plus grace, capped at 8 h. */
  ttlSeconds: number;
  expiresAt: string;
  keep: boolean;
  owner: string;
};

export type SandboxPod = {
  apiVersion: "v1";
  kind: "Pod";
  metadata: {
    name: string;
    labels: Record<string, string>;
    annotations: Record<string, string>;
  };
  spec: {
    restartPolicy: "Never";
    activeDeadlineSeconds: number;
    priorityClassName: string;
    nodeSelector: Record<string, string>;
    tolerations: (typeof CI_NODE_TOLERATION)[];
    automountServiceAccountToken: false;
    enableServiceLinks: false;
    securityContext: Record<string, unknown>;
    initContainers?: Container[];
    containers: Container[];
    volumes: { name: string; emptyDir: { sizeLimit: string } }[];
  };
};

export type Container = {
  name: string;
  image: string;
  command?: string[];
  env?: { name: string; value: string }[];
  ports?: { name: string; containerPort: number; protocol: "TCP" }[];
  resources: {
    requests: Record<string, string>;
    limits: Record<string, string>;
  };
  securityContext: Record<string, unknown>;
  volumeMounts: {
    name: string;
    mountPath: string;
    subPath?: string;
    readOnly?: boolean;
  }[];
};

const CONTAINER_SECURITY = {
  allowPrivilegeEscalation: false,
  readOnlyRootFilesystem: true,
  runAsNonRoot: true,
  capabilities: { drop: ["ALL"] },
  seccompProfile: { type: "RuntimeDefault" },
} as const;

/** Throws unless `image` is pinned by digest (repo:tag@sha256:… or repo@sha256:…). */
export function requireDigestPinned(image: string): string {
  if (!/@sha256:[0-9a-f]{64}$/u.test(image)) {
    throw new Error(`Sandbox image ${image} must be pinned by sha256 digest`);
  }
  return image;
}

export function activeDeadlineSeconds(ttlSeconds: number): number {
  return Math.min(
    ttlSeconds + DEADLINE_GRACE_SECONDS,
    MAX_ACTIVE_DEADLINE_SECONDS,
  );
}

/**
 * Builds the pod. Profiles that stage plugins or /data seed files get a
 * `stage` init container that waits for STAGING_READY (the provider copies the
 * staging tree in with `kubectl cp`, then touches it) and seeds /data; the
 * server mounts staged plugins read-only. Published images mount individual fixture
 * files so their baked /plugins content remains visible.
 */
export function buildSandboxPod(options: SandboxPodOptions): SandboxPod {
  const { profile } = options;
  const image = requireDigestPinned(profile.image);
  if (options.ttlSeconds > MAX_ACTIVE_DEADLINE_SECONDS) {
    throw new Error(
      `Cluster sandboxes live at most ${(MAX_ACTIVE_DEADLINE_SECONDS / 3600).toString()} h; requested ttl ${options.ttlSeconds.toString()} s`,
    );
  }
  const staging = stagesPlugins(profile) || profile.seedData;
  const main: Container = {
    name: MAIN_CONTAINER,
    image,
    env: Object.entries(profile.env).map(([name, value]) => ({ name, value })),
    ports: profile.ports.map((port) => ({
      name: PORT_NAMES[port] ?? `p${port.toString()}`,
      containerPort: port,
      protocol: "TCP",
    })),
    resources: {
      requests: {
        cpu: "1",
        memory: profile.memory.request,
        "ephemeral-storage": "2Gi",
      },
      // The data emptyDir (up to 6Gi) counts against this limit.
      limits: {
        cpu: "2",
        memory: profile.memory.limit,
        "ephemeral-storage": "8Gi",
      },
    },
    securityContext: CONTAINER_SECURITY,
    volumeMounts: [
      { name: "data", mountPath: "/data" },
      { name: "tmp", mountPath: "/tmp" },
      ...pluginMountTargets(profile).map((target) => ({
        name: "staging",
        mountPath: target === "" ? "/plugins" : `/plugins/${target}`,
        subPath: target === "" ? "plugins" : `plugins/${target}`,
        readOnly: true,
      })),
    ],
  };
  const stage: Container = {
    name: STAGE_CONTAINER,
    image,
    command: [
      "sh",
      "-c",
      `until [ -f ${STAGING_READY} ]; do sleep 1; done; if [ -d ${STAGING_DIR}/data ]; then cp -R ${STAGING_DIR}/data/. /data/; fi`,
    ],
    resources: {
      requests: { cpu: "50m", memory: "64Mi", "ephemeral-storage": "64Mi" },
      limits: { cpu: "500m", memory: "256Mi", "ephemeral-storage": "256Mi" },
    },
    securityContext: CONTAINER_SECURITY,
    volumeMounts: [
      { name: "staging", mountPath: STAGING_DIR },
      { name: "data", mountPath: "/data" },
    ],
  };
  return {
    apiVersion: "v1",
    kind: "Pod",
    metadata: {
      name: sandboxPodName(options.id),
      labels: {
        [MANAGED_BY_LABEL]: MANAGED_BY_VALUE,
        [SANDBOX_LABEL]: options.id,
        [PROFILE_LABEL]: options.profileName,
      },
      annotations: {
        [EXPIRES_AT_ANNOTATION]: options.expiresAt,
        [KEEP_ANNOTATION]: options.keep.toString(),
        [OWNER_ANNOTATION]: options.owner,
      },
    },
    spec: {
      restartPolicy: "Never",
      activeDeadlineSeconds: activeDeadlineSeconds(options.ttlSeconds),
      priorityClassName: SANDBOX_PRIORITY_CLASS,
      nodeSelector: { "kubernetes.io/hostname": CI_NODE_HOSTNAME },
      tolerations: [CI_NODE_TOLERATION],
      automountServiceAccountToken: false,
      enableServiceLinks: false,
      securityContext: {
        runAsNonRoot: true,
        runAsUser: 1000,
        runAsGroup: 3000,
        fsGroup: 2000,
        seccompProfile: { type: "RuntimeDefault" },
      },
      ...(staging ? { initContainers: [stage] } : {}),
      containers: [main],
      volumes: [
        { name: "data", emptyDir: { sizeLimit: "6Gi" } },
        { name: "tmp", emptyDir: { sizeLimit: "512Mi" } },
        ...(staging
          ? [{ name: "staging", emptyDir: { sizeLimit: "1Gi" } }]
          : []),
      ],
    },
  };
}
