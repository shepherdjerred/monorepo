import { z } from "zod";

export const ManagedResourceSchema = z.object({
  group: z.string().optional(),
  kind: z.string(),
  name: z.string(),
  namespace: z.string().optional(),
  liveState: z.string().optional(),
  targetState: z.string().optional(),
});

export const ManagedResourcesSchema = z.object({
  items: z.array(ManagedResourceSchema),
});

export type ManagedResource = z.infer<typeof ManagedResourceSchema>;

const JsonObjectSchema = z.record(z.string(), z.unknown());
const PROBE_HANDLERS = ["exec", "grpc", "httpGet", "tcpSocket"] as const;

function parseObject(
  source: string | undefined,
): Record<string, unknown> | null {
  if (source === undefined || source === "" || source === "null") {
    return null;
  }
  return JsonObjectSchema.parse(JSON.parse(source));
}

function valueAt(
  object: Record<string, unknown>,
  path: readonly string[],
): unknown {
  let current: unknown = object;
  for (const segment of path) {
    const parsed = JsonObjectSchema.safeParse(current);
    if (!parsed.success) {
      return undefined;
    }
    current = parsed.data[segment];
  }
  return current;
}

function targetMatchesLive(target: unknown, live: unknown): boolean {
  if (Array.isArray(target)) {
    return (
      Array.isArray(live) &&
      target.length === live.length &&
      target.every((entry, index) => targetMatchesLive(entry, live[index]))
    );
  }
  const targetObject = JsonObjectSchema.safeParse(target);
  if (targetObject.success) {
    const liveObject = JsonObjectSchema.safeParse(live);
    return (
      liveObject.success &&
      Object.entries(targetObject.data).every(([key, value]) =>
        targetMatchesLive(value, liveObject.data[key]),
      )
    );
  }
  return JSON.stringify(target) === JSON.stringify(live);
}

function declaredTargetChanged(
  live: Record<string, unknown>,
  target: Record<string, unknown>,
  path: readonly string[],
): boolean {
  const targetValue = valueAt(target, path);
  return (
    targetValue !== undefined &&
    !targetMatchesLive(targetValue, valueAt(live, path))
  );
}

function activeProbeHandler(probe: Record<string, unknown>): string | null {
  const handlers = PROBE_HANDLERS.filter(
    (handler) => probe[handler] !== undefined,
  );
  return handlers.length === 1 ? (handlers[0] ?? null) : null;
}

/**
 * Kubernetes merges container and init-container lists by `name`, so a chart
 * that inserts or reorders an entry leaves every other container untouched.
 * Key such lists by name and fall back to positions only for lists that are
 * not name-keyed, so a probe path identifies the same container on both sides.
 */
function arrayEntrySegments(entries: readonly unknown[]): readonly string[] {
  const names = entries.flatMap((entry) => {
    const parsed = JsonObjectSchema.safeParse(entry);
    if (!parsed.success) {
      return [];
    }
    const name = parsed.data["name"];
    return typeof name === "string" && name !== "" ? [name] : [];
  });
  if (names.length !== entries.length || new Set(names).size !== names.length) {
    return entries.map((_entry, index) => index.toString());
  }
  return names.map((name) => `[name=${name}]`);
}

function collectProbeHandlers(
  value: unknown,
  path: string,
  output: Map<string, string>,
): void {
  if (Array.isArray(value)) {
    const segments = arrayEntrySegments(value);
    for (const [index, entry] of value.entries()) {
      collectProbeHandlers(
        entry,
        `${path}/${segments[index] ?? index.toString()}`,
        output,
      );
    }
    return;
  }
  const parsed = JsonObjectSchema.safeParse(value);
  if (!parsed.success) {
    return;
  }
  for (const [key, entry] of Object.entries(parsed.data)) {
    const entryPath = `${path}/${key}`;
    if (
      key === "livenessProbe" ||
      key === "readinessProbe" ||
      key === "startupProbe"
    ) {
      const probe = JsonObjectSchema.safeParse(entry);
      if (probe.success) {
        const handler = activeProbeHandler(probe.data);
        if (handler !== null) {
          output.set(entryPath, handler);
        }
      }
    }
    collectProbeHandlers(entry, entryPath, output);
  }
}

function identity(resource: ManagedResource): string {
  return `${resource.group ?? ""}/${resource.kind} ${resource.namespace ?? "_cluster"}/${resource.name}`;
}

function immutablePaths(kind: string): readonly (readonly string[])[] {
  switch (kind) {
    // A DaemonSet's selector is as immutable as a Deployment's; the API server
    // rejects the update rather than replacing the workload.
    case "DaemonSet":
    case "Deployment":
      return [["spec", "selector"]];
    case "StatefulSet":
      return [
        ["spec", "podManagementPolicy"],
        ["spec", "selector"],
        ["spec", "serviceName"],
        ["spec", "volumeClaimTemplates"],
      ];
    case "PersistentVolumeClaim":
      return [
        ["spec", "accessModes"],
        ["spec", "dataSource"],
        ["spec", "dataSourceRef"],
        ["spec", "storageClassName"],
        ["spec", "volumeMode"],
        ["spec", "volumeName"],
      ];
    case "Service":
      return [
        ["spec", "clusterIP"],
        ["spec", "clusterIPs"],
        ["spec", "ipFamilies"],
      ];
    default:
      return [];
  }
}

export function analyzeApplySafety(
  resources: readonly ManagedResource[],
): readonly string[] {
  const findings: string[] = [];
  for (const resource of resources) {
    const live = parseObject(resource.liveState);
    const target = parseObject(resource.targetState);
    if (live === null || target === null) {
      continue;
    }
    for (const path of immutablePaths(resource.kind)) {
      if (declaredTargetChanged(live, target, path)) {
        findings.push(
          `${identity(resource)} changes immutable /${path.join("/")}`,
        );
      }
    }
    const liveProbes = new Map<string, string>();
    const targetProbes = new Map<string, string>();
    collectProbeHandlers(live, "", liveProbes);
    collectProbeHandlers(target, "", targetProbes);
    for (const [path, liveHandler] of liveProbes) {
      const targetHandler = targetProbes.get(path);
      if (targetHandler !== undefined && targetHandler !== liveHandler) {
        findings.push(
          `${identity(resource)} changes ${path} handler from ${liveHandler} to ${targetHandler}; use a resource-scoped replace`,
        );
      }
    }
  }
  return findings;
}
