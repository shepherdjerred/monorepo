import type {
  PodStatus,
  VeleroBackupStatus,
  VeleroScheduleStatus,
} from "@shepherdjerred/ops-clients/kubernetes.ts";
import type { PrometheusSample } from "@shepherdjerred/ops-clients/prometheus.ts";
import type { ClusterFacet } from "@shepherdjerred/ops-model/facets.ts";

const RATED_WRITES_PER_CAPACITY = 600;
const FIVE_YEAR_DAYS = 5 * 365;

export function resolveNodeName(metric: Record<string, string>): string {
  const raw = metric["node"] ?? metric["nodename"] ?? metric["instance"] ?? "";
  return (raw.split(":")[0] ?? raw).trim();
}

export function buildZpools(input: {
  size: readonly PrometheusSample[];
  free: readonly PrometheusSample[];
  frag: readonly PrometheusSample[];
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
          health: "ONLINE",
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

export function buildDatabases(input: {
  pods: readonly PodStatus[];
  pvcUsed: readonly PrometheusSample[];
  pvcCap: readonly PrometheusSample[];
  veleroBackups: readonly VeleroBackupStatus[];
  veleroSchedules: readonly VeleroScheduleStatus[];
}): ClusterFacet["databases"] {
  const hasVelero =
    input.veleroSchedules.some((s) => !s.paused) ||
    input.veleroBackups.some((b) => b.phase === "Completed");

  const usedByNs = new Map<string, number>();
  for (const s of input.pvcUsed) {
    const ns = s.metric["namespace"] ?? "";
    if (ns !== "" && Number.isFinite(s.value)) {
      usedByNs.set(ns, Math.max(usedByNs.get(ns) ?? 0, Math.round(s.value)));
    }
  }
  const capByNs = new Map<string, number>();
  for (const s of input.pvcCap) {
    const ns = s.metric["namespace"] ?? "";
    if (ns !== "" && Number.isFinite(s.value)) {
      capByNs.set(ns, Math.max(capByNs.get(ns) ?? 0, Math.round(s.value)));
    }
  }

  const dbGroups = new Map<
    string,
    {
      name: string;
      namespace: string;
      engine: "postgres" | "mariadb";
      ready: boolean;
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
      });
    } else if (!ready) {
      prev.ready = false;
    }
  }

  return [...dbGroups.values()]
    .map((db) => ({
      ...db,
      usedBytes: usedByNs.get(db.namespace) ?? null,
      capacityBytes: capByNs.get(db.namespace) ?? null,
      veleroBackedUp: hasVelero,
    }))
    .sort(
      (a, b) =>
        a.namespace.localeCompare(b.namespace) || a.name.localeCompare(b.name),
    );
}
