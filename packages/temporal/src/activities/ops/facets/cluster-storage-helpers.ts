import type {
  PodStatus,
  VeleroBackupStatus,
  VeleroScheduleStatus,
} from "@shepherdjerred/ops-clients/kubernetes.ts";
import type { PrometheusSample } from "@shepherdjerred/ops-clients/prometheus.ts";
import type { ClusterFacet } from "@shepherdjerred/ops-model/facets.ts";

const RATED_WRITES_PER_CAPACITY = 600;
const FIVE_YEAR_DAYS = 5 * 365;
const TERMINAL_VELERO_PHASES = new Set([
  "Completed",
  "PartiallyFailed",
  "Failed",
  "FailedValidation",
]);

export function resolveNodeName(metric: Record<string, string>): string {
  const raw = metric["node"] ?? metric["nodename"] ?? metric["instance"] ?? "";
  return (raw.split(":")[0] ?? raw).trim();
}

function zpoolHealthSeverity(health: string): number {
  switch (health) {
    case "ONLINE":
      return 1;
    case "DEGRADED":
    case "OFFLINE":
      return 2;
    default:
      return 3;
  }
}

function indexZpoolHealth(
  samples: readonly PrometheusSample[],
): Map<string, string> {
  const byKey = new Map<string, string>();
  for (const s of samples) {
    if (!Number.isFinite(s.value) || s.value <= 0) {
      continue;
    }
    const pool = s.metric["zpool_name"] ?? "";
    const health = (s.metric["health"] ?? "").trim().toUpperCase();
    if (pool === "" || health === "") {
      continue;
    }
    const key = `${resolveNodeName(s.metric)}\u0000${pool}`;
    const existing = byKey.get(key);
    if (
      existing === undefined ||
      zpoolHealthSeverity(health) > zpoolHealthSeverity(existing)
    ) {
      byKey.set(key, health);
    }
  }
  return byKey;
}

export function buildZpools(input: {
  size: readonly PrometheusSample[];
  free: readonly PrometheusSample[];
  frag: readonly PrometheusSample[];
  health?: readonly PrometheusSample[];
}): ClusterFacet["zpools"] {
  const freeByKey = new Map<string, number>();
  for (const s of input.free) {
    const key = `${resolveNodeName(s.metric)}\u0000${s.metric["zpool_name"] ?? ""}`;
    freeByKey.set(key, s.value);
  }
  const fragByKey = new Map<string, number>();
  for (const s of input.frag) {
    const key = `${resolveNodeName(s.metric)}\u0000${s.metric["zpool_name"] ?? ""}`;
    fragByKey.set(key, s.value);
  }
  const healthByKey = indexZpoolHealth(input.health ?? []);

  return input.size
    .flatMap((s): ClusterFacet["zpools"] => {
      const node = resolveNodeName(s.metric) || "cluster";
      const pool = s.metric["zpool_name"] ?? "";
      if (pool === "" || !Number.isFinite(s.value)) {
        return [];
      }
      const key = `${resolveNodeName(s.metric)}\u0000${pool}`;
      const sizeBytes = Math.round(s.value);
      const freeBytes = Math.round(freeByKey.get(key) ?? 0);
      const usedBytes = Math.max(0, sizeBytes - freeBytes);
      const frag = fragByKey.get(key);
      return [
        {
          node,
          pool,
          usedBytes,
          sizeBytes,
          freeBytes,
          fragmentationPercent:
            frag !== undefined && Number.isFinite(frag)
              ? Math.round(frag * 10) / 10
              : null,
          health: healthByKey.get(key) ?? "UNKNOWN",
        },
      ];
    })
    .sort(
      (a, b) => a.node.localeCompare(b.node) || a.pool.localeCompare(b.pool),
    );
}

function driveKey(m: Record<string, string>): string {
  return `${resolveNodeName(m)}\u0000${m["serial"] ?? m["device"] ?? ""}`;
}

export function buildNvmeDrives(input: {
  written24h: readonly PrometheusSample[];
  budget: readonly PrometheusSample[];
  size: readonly PrometheusSample[];
  wear: readonly PrometheusSample[];
  temp: readonly PrometheusSample[];
}): ClusterFacet["nvmeDrives"] {
  const budgetByKey = new Map(
    input.budget.map((s) => [driveKey(s.metric), s.value]),
  );
  const sizeByKey = new Map(
    input.size.map((s) => [driveKey(s.metric), s.value]),
  );
  const wearByKey = new Map(
    input.wear.map((s) => [driveKey(s.metric), s.value]),
  );
  const tempByKey = new Map(
    input.temp.map((s) => [driveKey(s.metric), s.value]),
  );

  const seed = input.written24h.length > 0 ? input.written24h : input.wear;
  return seed
    .flatMap((s): ClusterFacet["nvmeDrives"] => {
      const node = resolveNodeName(s.metric) || "cluster";
      const device = s.metric["device"] ?? s.metric["serial"] ?? "";
      if (device === "") {
        return [];
      }
      const key = driveKey(s.metric);
      const written24hBytes =
        input.written24h.length > 0 && Number.isFinite(s.value)
          ? Math.max(0, Math.round(s.value))
          : 0;
      const recordedBudget = budgetByKey.get(key);
      const physicalSize = sizeByKey.get(key) ?? 0;
      const fallbackBudget =
        physicalSize > 0
          ? Math.round(
              (physicalSize * RATED_WRITES_PER_CAPACITY) / FIVE_YEAR_DAYS,
            )
          : 0;
      const dailyBudgetBytes =
        recordedBudget !== undefined && Number.isFinite(recordedBudget)
          ? Math.round(recordedBudget)
          : fallbackBudget;
      const wearVal = wearByKey.get(key);
      const tempVal = tempByKey.get(key);
      const model = s.metric["model"]?.trim();
      return [
        {
          node,
          device,
          ...(model === undefined || model === "" ? {} : { model }),
          written24hBytes,
          dailyBudgetBytes,
          wearPercent:
            wearVal !== undefined && Number.isFinite(wearVal)
              ? Math.round(wearVal * 10) / 10
              : null,
          tempCelsius:
            tempVal !== undefined && Number.isFinite(tempVal)
              ? Math.round(tempVal * 10) / 10
              : null,
        },
      ];
    })
    .sort(
      (a, b) =>
        a.node.localeCompare(b.node) || a.device.localeCompare(b.device),
    );
}

function classifyDbEngine(
  name: string,
  namespace: string,
): "postgres" | "mariadb" | undefined {
  const lower = `${namespace}/${name}`.toLowerCase();
  if (lower.includes("mariadb") || lower.includes("mysql")) {
    return "mariadb";
  }
  const isPostgres =
    lower.includes("postgres") ||
    /(?:^|-)pg(?:-|$|\d)/u.test(name.toLowerCase()) ||
    lower.endsWith("-db-0") ||
    lower.includes("grafana-db");
  return isPostgres ? "postgres" : undefined;
}

function evaluateVeleroBackupRunHealth(
  backups: readonly VeleroBackupStatus[],
  schedules: readonly VeleroScheduleStatus[],
  veleroLastStatus: readonly PrometheusSample[],
): boolean | null {
  const terminal = backups.filter(
    (b) => b.phase !== undefined && TERMINAL_VELERO_PHASES.has(b.phase),
  );
  const activeSchedules = schedules.filter((s) => !s.paused);
  if (terminal.length > 0) {
    const latestBySchedule = new Map<string, VeleroBackupStatus>();
    for (const b of terminal) {
      const key = b.schedule ?? "__manual__";
      const ts = b.completedAt ?? b.startedAt ?? b.createdAt;
      const prev = latestBySchedule.get(key);
      const prevTs =
        prev === undefined
          ? ""
          : (prev.completedAt ?? prev.startedAt ?? prev.createdAt);
      if (prev === undefined || ts >= prevTs) {
        latestBySchedule.set(key, b);
      }
    }
    const latestRuns = [...latestBySchedule.values()];
    return (
      latestRuns.some((b) => b.phase === "Completed") &&
      latestRuns.every((b) => b.phase === "Completed")
    );
  }
  if (veleroLastStatus.length > 0) {
    return (
      veleroLastStatus.some((s) => s.value === 1) &&
      veleroLastStatus.every((s) => s.value === 1)
    );
  }
  return activeSchedules.length > 0 ? false : null;
}

function indexPodPvcs(
  samples: readonly PrometheusSample[],
): Map<string, Set<string>> {
  const byPod = new Map<string, Set<string>>();
  for (const s of samples) {
    if (!Number.isFinite(s.value) || s.value <= 0) {
      continue;
    }
    const ns = s.metric["namespace"] ?? "";
    const pod = s.metric["pod"] ?? "";
    const pvc = s.metric["persistentvolumeclaim"] ?? "";
    if (ns === "" || pod === "" || pvc === "") {
      continue;
    }
    const key = `${ns}\u0000${pod}`;
    const set = byPod.get(key) ?? new Set<string>();
    set.add(pvc);
    byPod.set(key, set);
  }
  return byPod;
}

function indexBackedUpPvcs(samples: readonly PrometheusSample[]): Set<string> {
  const set = new Set<string>();
  for (const s of samples) {
    if (!Number.isFinite(s.value) || s.value <= 0) {
      continue;
    }
    const ns = s.metric["namespace"] ?? "";
    const pvc = s.metric["persistentvolumeclaim"] ?? "";
    if (ns !== "" && pvc !== "") {
      set.add(`${ns}\u0000${pvc}`);
    }
  }
  return set;
}

function indexPvcBytes(
  samples: readonly PrometheusSample[],
): Map<string, number> {
  const map = new Map<string, number>();
  for (const s of samples) {
    const ns = s.metric["namespace"] ?? "";
    const pvc = s.metric["persistentvolumeclaim"] ?? "";
    if (ns !== "" && pvc !== "" && Number.isFinite(s.value)) {
      map.set(`${ns}\u0000${pvc}`, Math.round(s.value));
    }
  }
  return map;
}

function resolveDbVeleroBackedUp(input: {
  namespace: string;
  pods: readonly string[];
  pvcsByPod: ReadonlyMap<string, Set<string>>;
  backedUpPvcs: ReadonlySet<string>;
  backupRunHealthy: boolean | null;
}): { veleroBackedUp: boolean | null; mountedPvcs: Set<string> } {
  const mountedPvcs = new Set<string>();
  for (const podName of input.pods) {
    const pvcs = input.pvcsByPod.get(`${input.namespace}\u0000${podName}`);
    if (pvcs !== undefined) {
      for (const pvc of pvcs) {
        mountedPvcs.add(pvc);
      }
    }
  }
  if (mountedPvcs.size === 0) {
    return { veleroBackedUp: null, mountedPvcs };
  }
  const allPvcsOptedIn = [...mountedPvcs].every((pvc) =>
    input.backedUpPvcs.has(`${input.namespace}\u0000${pvc}`),
  );
  return {
    veleroBackedUp: allPvcsOptedIn ? input.backupRunHealthy : false,
    mountedPvcs,
  };
}

function sumMountedOrMaxNamespaceBytes(
  namespace: string,
  mountedPvcs: ReadonlySet<string>,
  byPvc: ReadonlyMap<string, number>,
  samples: readonly PrometheusSample[],
): number | null {
  if (mountedPvcs.size > 0) {
    let total = 0;
    let found = false;
    for (const pvc of mountedPvcs) {
      const val = byPvc.get(`${namespace}\u0000${pvc}`);
      if (val !== undefined) {
        total += val;
        found = true;
      }
    }
    if (found) {
      return total;
    }
  }
  let maxNs: number | null = null;
  for (const s of samples) {
    if (
      (s.metric["namespace"] ?? "") === namespace &&
      Number.isFinite(s.value)
    ) {
      maxNs = Math.max(maxNs ?? 0, Math.round(s.value));
    }
  }
  return maxNs;
}

export function buildDatabases(input: {
  pods: readonly PodStatus[];
  pvcUsed: readonly PrometheusSample[];
  pvcCap: readonly PrometheusSample[];
  podPvcs?: readonly PrometheusSample[];
  backedUpPvcs?: readonly PrometheusSample[];
  veleroLastStatus?: readonly PrometheusSample[];
  veleroBackups: readonly VeleroBackupStatus[];
  veleroSchedules: readonly VeleroScheduleStatus[];
}): ClusterFacet["databases"] {
  const backupRunHealthy = evaluateVeleroBackupRunHealth(
    input.veleroBackups,
    input.veleroSchedules,
    input.veleroLastStatus ?? [],
  );
  const pvcsByPod = indexPodPvcs(input.podPvcs ?? []);
  const backedUpPvcs = indexBackedUpPvcs(input.backedUpPvcs ?? []);
  const usedByPvc = indexPvcBytes(input.pvcUsed);
  const capByPvc = indexPvcBytes(input.pvcCap);

  const dbGroups = new Map<
    string,
    {
      name: string;
      namespace: string;
      engine: "postgres" | "mariadb";
      ready: boolean;
      pods: string[];
    }
  >();

  for (const pod of input.pods) {
    const engine = classifyDbEngine(pod.name, pod.namespace);
    if (engine === undefined || pod.namespace === "postgres-operator") {
      continue;
    }
    const baseName = pod.name.replace(/-\d+$/u, "");
    const key = `${pod.namespace}/${baseName}`;
    const ready = pod.phase === "Running" && pod.problem === undefined;
    const prev = dbGroups.get(key);
    if (prev === undefined) {
      dbGroups.set(key, {
        name: baseName,
        namespace: pod.namespace,
        engine,
        ready,
        pods: [pod.name],
      });
    } else {
      prev.pods.push(pod.name);
      if (!ready) {
        prev.ready = false;
      }
    }
  }

  return [...dbGroups.values()]
    .map((db) => {
      const { veleroBackedUp, mountedPvcs } = resolveDbVeleroBackedUp({
        namespace: db.namespace,
        pods: db.pods,
        pvcsByPod,
        backedUpPvcs,
        backupRunHealthy,
      });
      return {
        name: db.name,
        namespace: db.namespace,
        engine: db.engine,
        ready: db.ready,
        usedBytes: sumMountedOrMaxNamespaceBytes(
          db.namespace,
          mountedPvcs,
          usedByPvc,
          input.pvcUsed,
        ),
        capacityBytes: sumMountedOrMaxNamespaceBytes(
          db.namespace,
          mountedPvcs,
          capByPvc,
          input.pvcCap,
        ),
        veleroBackedUp,
      };
    })
    .sort(
      (a, b) =>
        a.namespace.localeCompare(b.namespace) || a.name.localeCompare(b.name),
    );
}
