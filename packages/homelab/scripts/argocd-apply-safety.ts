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

/**
 * What it means for the requested target to omit an immutable field. "No
 * default" was previously conflated into one case, which hid a real class of
 * change: a field the chart author owns is not the same as one the API server
 * populates. Every immutable field must say which it is, so adding one forces
 * the question rather than defaulting to silence.
 */
type ImmutableField = {
  readonly path: readonly string[];
} & (
  | {
      /**
       * The API server populates it and keeps the live value when the request
       * omits it, so omission declares no change. Flagging it would fail every
       * release whose chart simply never mentions the field.
       */
      readonly omission: "keeps-live-value";
    }
  | {
      /**
       * The API server defaults it, so omitting it resets the field to that
       * default. That is a change exactly when the live value is not already
       * the default.
       */
      readonly omission: "resets-to-default";
      readonly apiDefault: string;
    }
  | {
      /**
       * The chart author owns it and the API server neither populates nor
       * defaults it, so removing the declaration removes a previously managed
       * immutable field. Kubernetes rejects that like any other change to it.
       */
      readonly omission: "removes-managed-field";
    }
);

function omissionChanges(field: ImmutableField, liveValue: unknown): boolean {
  if (liveValue === undefined) {
    return false;
  }
  switch (field.omission) {
    case "keeps-live-value":
      return false;
    case "resets-to-default":
      return liveValue !== field.apiDefault;
    case "removes-managed-field":
      return true;
  }
}

function declaredTargetChanged(
  live: Record<string, unknown>,
  target: Record<string, unknown>,
  field: ImmutableField,
): boolean {
  const targetValue = valueAt(target, field.path);
  const liveValue = valueAt(live, field.path);
  return targetValue === undefined
    ? omissionChanges(field, liveValue)
    : !targetMatchesLive(targetValue, liveValue);
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

function immutableFields(kind: string): readonly ImmutableField[] {
  switch (kind) {
    // A DaemonSet's selector is as immutable as a Deployment's; the API server
    // rejects the update rather than replacing the workload.
    case "DaemonSet":
    case "Deployment":
      return [
        { path: ["spec", "selector"], omission: "removes-managed-field" },
      ];
    case "StatefulSet":
      return [
        {
          path: ["spec", "podManagementPolicy"],
          omission: "resets-to-default",
          apiDefault: "OrderedReady",
        },
        { path: ["spec", "selector"], omission: "removes-managed-field" },
        { path: ["spec", "serviceName"], omission: "removes-managed-field" },
        {
          path: ["spec", "volumeClaimTemplates"],
          omission: "removes-managed-field",
        },
      ];
    case "PersistentVolumeClaim":
      return [
        { path: ["spec", "accessModes"], omission: "removes-managed-field" },
        // The API server cross-populates these two, so a claim authored with
        // only one of them reports both. Treating an omission as a change would
        // fail every such claim, so under-report rather than block releases.
        { path: ["spec", "dataSource"], omission: "keeps-live-value" },
        { path: ["spec", "dataSourceRef"], omission: "keeps-live-value" },
        // Defaulted from the cluster's default StorageClass at creation, so a
        // live claim carries one whether or not the chart ever declared it.
        { path: ["spec", "storageClassName"], omission: "keeps-live-value" },
        {
          path: ["spec", "volumeMode"],
          omission: "resets-to-default",
          apiDefault: "Filesystem",
        },
        { path: ["spec", "volumeName"], omission: "keeps-live-value" },
      ];
    case "Service":
      // All three are assigned by the cluster, not the chart.
      return [
        { path: ["spec", "clusterIP"], omission: "keeps-live-value" },
        { path: ["spec", "clusterIPs"], omission: "keeps-live-value" },
        { path: ["spec", "ipFamilies"], omission: "keeps-live-value" },
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
    for (const field of immutableFields(resource.kind)) {
      if (declaredTargetChanged(live, target, field)) {
        findings.push(
          `${identity(resource)} changes immutable /${field.path.join("/")}`,
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
