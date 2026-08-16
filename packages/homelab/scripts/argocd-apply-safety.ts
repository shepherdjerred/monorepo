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

/**
 * Unreadable state stays fatal — a resource whose live or target state cannot
 * be parsed is a broken contract, not a finding, and continuing would report
 * "no immutable changes" for a resource nobody actually inspected. But the
 * failure has to say which resource and which side, because the preflight
 * reads every managed resource in the application and a bare JSON or Zod
 * message names none of them.
 */
export function parseObject(
  source: string | undefined,
  resource: ManagedResource,
  field: "liveState" | "targetState",
): Record<string, unknown> | null {
  if (source === undefined || source === "" || source === "null") {
    return null;
  }
  try {
    return JsonObjectSchema.parse(JSON.parse(source));
  } catch (error) {
    throw new Error(`Could not read ${field} for ${identity(resource)}`, {
      cause: error,
    });
  }
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

/**
 * What a key found only in the live value means. `omission` below classifies
 * dropping a whole immutable field; this classifies dropping something inside
 * one. Comparing only the target's keys answered that silently as "no change",
 * so removing a selector label passed the preflight and was rejected later by
 * the API server, mid-release, after earlier resources had already applied.
 */
type LiveOnlyKeys =
  /**
   * The API server populates keys the request never sets, so a live-only key
   * is its doing rather than a removal. Only the declared keys can be
   * compared; flagging the rest would fail every release whose chart omits a
   * defaulted key.
   */
  | "api-populates"
  /**
   * The chart author owns every key, so a key that exists only in live was
   * removed from the declaration. Kubernetes rejects that like any other
   * change to an immutable field.
   */
  | "removes-managed-key";

function targetMatchesLive(
  target: unknown,
  live: unknown,
  liveOnlyKeys: LiveOnlyKeys,
): boolean {
  if (Array.isArray(target)) {
    return (
      Array.isArray(live) &&
      target.length === live.length &&
      target.every((entry, index) =>
        targetMatchesLive(entry, live[index], liveOnlyKeys),
      )
    );
  }
  const targetObject = JsonObjectSchema.safeParse(target);
  if (targetObject.success) {
    const liveObject = JsonObjectSchema.safeParse(live);
    if (!liveObject.success) {
      return false;
    }
    if (
      liveOnlyKeys === "removes-managed-key" &&
      Object.keys(liveObject.data).some(
        (key) => !Object.hasOwn(targetObject.data, key),
      )
    ) {
      return false;
    }
    return Object.entries(targetObject.data).every(([key, value]) =>
      targetMatchesLive(value, liveObject.data[key], liveOnlyKeys),
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
  readonly liveOnlyKeys: LiveOnlyKeys;
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
    : !targetMatchesLive(targetValue, liveValue, field.liveOnlyKeys);
}

/**
 * A list whose entries are themselves resources of a known kind, compared with
 * that kind's own immutable-field rules.
 *
 * The surrounding list has to tolerate live-only keys, because the API server
 * writes them into every entry. That tolerance is what lets an author-owned key
 * removed from one entry — dropping `accessModes` from a claim template — read
 * as no change. Descending with the entry kind's rules recovers the precision:
 * each of those fields already declares whether the API server owns it, so the
 * classification comes from one reviewed table rather than a second list of
 * server-defaulted keys that would drift with every Kubernetes release.
 */
type EmbeddedResourceList = {
  readonly path: readonly string[];
  readonly entryKind: string;
};

function embeddedResourceLists(kind: string): readonly EmbeddedResourceList[] {
  switch (kind) {
    case "StatefulSet":
      return [
        {
          path: ["spec", "volumeClaimTemplates"],
          entryKind: "PersistentVolumeClaim",
        },
      ];
    default:
      return [];
  }
}

function entriesByName(value: unknown): Map<string, Record<string, unknown>> {
  const byName = new Map<string, Record<string, unknown>>();
  if (!Array.isArray(value)) {
    return byName;
  }
  for (const entry of value) {
    const parsed = JsonObjectSchema.safeParse(entry);
    if (!parsed.success) {
      continue;
    }
    const name = valueAt(parsed.data, ["metadata", "name"]);
    if (typeof name === "string" && name !== "") {
      byName.set(name, parsed.data);
    }
  }
  return byName;
}

/**
 * Entries are matched by name rather than position: the enclosing list already
 * reports an added, removed, or reordered entry, so descending by index would
 * only restate that as a pile of per-field findings.
 */
function embeddedListFindings(
  live: Record<string, unknown>,
  target: Record<string, unknown>,
  list: EmbeddedResourceList,
  resourceIdentity: string,
): readonly string[] {
  const liveEntries = entriesByName(valueAt(live, list.path));
  const targetEntries = entriesByName(valueAt(target, list.path));
  const findings: string[] = [];
  for (const [name, targetEntry] of targetEntries) {
    const liveEntry = liveEntries.get(name);
    if (liveEntry === undefined) {
      continue;
    }
    for (const field of immutableFields(list.entryKind)) {
      if (declaredTargetChanged(liveEntry, targetEntry, field)) {
        findings.push(
          `${resourceIdentity} changes immutable /${list.path.join("/")}/[name=${name}]/${field.path.join("/")}`,
        );
      }
    }
  }
  return findings;
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
        {
          path: ["spec", "selector"],
          omission: "removes-managed-field",
          liveOnlyKeys: "removes-managed-key",
        },
      ];
    case "StatefulSet":
      return [
        {
          path: ["spec", "podManagementPolicy"],
          omission: "resets-to-default",
          apiDefault: "OrderedReady",
          liveOnlyKeys: "removes-managed-key",
        },
        {
          path: ["spec", "selector"],
          omission: "removes-managed-field",
          liveOnlyKeys: "removes-managed-key",
        },
        {
          path: ["spec", "serviceName"],
          omission: "removes-managed-field",
          liveOnlyKeys: "removes-managed-key",
        },
        {
          path: ["spec", "volumeClaimTemplates"],
          omission: "removes-managed-field",
          // Each template is a claim the API server defaults like any other:
          // volumeMode, storageClassName, and status appear on the live copy
          // whether or not the chart wrote them.
          liveOnlyKeys: "api-populates",
        },
      ];
    case "PersistentVolumeClaim":
      return [
        {
          path: ["spec", "accessModes"],
          omission: "removes-managed-field",
          liveOnlyKeys: "removes-managed-key",
        },
        // The API server cross-populates these two, so a claim authored with
        // only one of them reports both. Treating an omission as a change would
        // fail every such claim, so under-report rather than block releases.
        // The same cross-population adds keys inside them.
        {
          path: ["spec", "dataSource"],
          omission: "keeps-live-value",
          liveOnlyKeys: "api-populates",
        },
        {
          path: ["spec", "dataSourceRef"],
          omission: "keeps-live-value",
          liveOnlyKeys: "api-populates",
        },
        // Binds the claim to a matching volume. The author owns it and nothing
        // defaults it, so changing or dropping it is an immutable update.
        {
          path: ["spec", "selector"],
          omission: "removes-managed-field",
          liveOnlyKeys: "removes-managed-key",
        },
        // Defaulted from the cluster's default StorageClass at creation, so a
        // live claim carries one whether or not the chart ever declared it.
        {
          path: ["spec", "storageClassName"],
          omission: "keeps-live-value",
          liveOnlyKeys: "removes-managed-key",
        },
        {
          path: ["spec", "volumeMode"],
          omission: "resets-to-default",
          apiDefault: "Filesystem",
          liveOnlyKeys: "removes-managed-key",
        },
        {
          path: ["spec", "volumeName"],
          omission: "keeps-live-value",
          liveOnlyKeys: "removes-managed-key",
        },
      ];
    case "Service":
      // All three are assigned by the cluster, not the chart. Each holds a
      // string or a list of strings, so there is no key inside for the API
      // server to populate.
      return [
        {
          path: ["spec", "clusterIP"],
          omission: "keeps-live-value",
          liveOnlyKeys: "removes-managed-key",
        },
        {
          path: ["spec", "clusterIPs"],
          omission: "keeps-live-value",
          liveOnlyKeys: "removes-managed-key",
        },
        {
          path: ["spec", "ipFamilies"],
          omission: "keeps-live-value",
          liveOnlyKeys: "removes-managed-key",
        },
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
    const live = parseObject(resource.liveState, resource, "liveState");
    const target = parseObject(resource.targetState, resource, "targetState");
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
    for (const list of embeddedResourceLists(resource.kind)) {
      findings.push(
        ...embeddedListFindings(live, target, list, identity(resource)),
      );
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
