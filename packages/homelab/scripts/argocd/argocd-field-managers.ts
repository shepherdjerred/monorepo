import { z } from "zod";
import {
  identity,
  parseObject,
  type ManagedResource,
} from "./argocd-apply-safety.ts";
import { targetIsRecreatedHook } from "./argocd-hooks.ts";
import { JsonObjectSchema, valueAt } from "./argocd-json-path.ts";

/**
 * The field manager Argo CD's server-side apply writes as. Every other manager
 * that owns a field keeps it alive: server-side apply removes a field the
 * applied configuration dropped only when the applier was its sole owner.
 */
export const ARGO_SERVER_SIDE_APPLY_MANAGER = "argocd-controller";

export const STALE_FIELD_MANAGER_HOW_TO =
  "/how-to/clear-a-stale-field-manager/";

const ARGO_SYNC_OPTIONS_ANNOTATION = "argocd.argoproj.io/sync-options";

/**
 * Name-keyed pod lists whose entries a chart adds, moves and removes. A
 * leftover entry here is never cosmetic: it is a container that keeps running,
 * a container whose name collides with its replacement in the other list (the
 * API server rejects duplicate names across both), or a volume that keeps
 * mounting a retired source.
 */
const ENTRY_LISTS = new Set([
  "f:containers",
  "f:initContainers",
  "f:ephemeralContainers",
  "f:volumes",
]);

const ManagedFieldsEntrySchema = z
  .object({
    manager: z.string().optional(),
    operation: z.string().optional(),
    time: z.string().optional(),
    subresource: z.string().optional(),
    fieldsV1: z.record(z.string(), z.unknown()).optional(),
  })
  .loose();

const ManagedFieldsSchema = z
  .object({
    metadata: z
      .object({
        managedFields: z.array(ManagedFieldsEntrySchema).optional(),
        annotations: z.record(z.string(), z.string()).optional(),
      })
      .loose()
      .optional(),
  })
  .loose();

const NameKeySchema = z.object({ name: z.string().min(1) }).loose();

function entryName(key: string): string | null {
  if (!key.startsWith("k:")) return null;
  try {
    const parsed = NameKeySchema.safeParse(JSON.parse(key.slice(2)));
    return parsed.success ? parsed.data.name : null;
  } catch {
    return null;
  }
}

function declaredNames(
  target: Record<string, unknown>,
  path: readonly string[],
) {
  const value = valueAt(target, path);
  const names = new Set<string>();
  if (!Array.isArray(value)) return names;
  for (const entry of value) {
    const parsed = JsonObjectSchema.safeParse(entry);
    const name = parsed.success ? parsed.data["name"] : undefined;
    if (typeof name === "string") names.add(name);
  }
  return names;
}

type OwnedEntry = { readonly path: readonly string[]; readonly name: string };

/**
 * Walks a `fieldsV1` tree through plain fields only and returns every
 * name-keyed entry of a pod list it reaches. Paths stop at list entries, so a
 * pod template nested under `spec.template` or `spec.jobTemplate` is found
 * while the fields inside an entry are not.
 */
function ownedEntries(
  fields: Record<string, unknown>,
  path: readonly string[],
): readonly OwnedEntry[] {
  const found: OwnedEntry[] = [];
  for (const [key, value] of Object.entries(fields)) {
    if (!key.startsWith("f:")) continue;
    const child = z.record(z.string(), z.unknown()).safeParse(value);
    if (!child.success) continue;
    const childPath = [...path, key.slice(2)];
    if (ENTRY_LISTS.has(key)) {
      for (const entryKey of Object.keys(child.data)) {
        const name = entryName(entryKey);
        if (name !== null) found.push({ path: childPath, name });
      }
      continue;
    }
    found.push(...ownedEntries(child.data, childPath));
  }
  return found;
}

function syncOptions(manifest: Record<string, unknown>): ReadonlySet<string> {
  const annotation =
    ManagedFieldsSchema.parse(manifest).metadata?.annotations?.[
      ARGO_SYNC_OPTIONS_ANNOTATION
    ];
  return new Set((annotation ?? "").split(",").map((option) => option.trim()));
}

/**
 * Whether Argo CD applies this resource server-side. A resource-scoped sync
 * option overrides the Application's. Client-side apply deletes a removed
 * entry through the last-applied annotation whoever owns it, so only
 * server-side apply can strand one.
 */
export function resourceUsesServerSideApply(
  target: Record<string, unknown>,
  applicationServerSideApply: boolean,
): boolean {
  const options = syncOptions(target);
  return (
    !options.has("ServerSideApply=false") &&
    (applicationServerSideApply || options.has("ServerSideApply=true"))
  );
}

type ManagedFieldsEntry = z.infer<typeof ManagedFieldsEntrySchema>;

/** Status writes and Argo's own apply never hold a spec entry against it. */
function holdsSpecEntries(manager: ManagedFieldsEntry): boolean {
  return (
    manager.manager !== ARGO_SERVER_SIDE_APPLY_MANAGER &&
    (manager.subresource === undefined || manager.subresource === "") &&
    manager.fieldsV1 !== undefined
  );
}

function strandedEntryFinding(
  resourceIdentity: string,
  entry: OwnedEntry,
  manager: ManagedFieldsEntry,
): string {
  const name =
    manager.manager === undefined || manager.manager === ""
      ? "(unnamed)"
      : manager.manager;
  return `${resourceIdentity} drops /${entry.path.join("/")}/[name=${entry.name}], which field manager ${name} (${manager.operation ?? "unknown operation"} at ${manager.time ?? "unknown time"}) still co-owns; server-side apply keeps a co-owned entry, so clear that manager first (${STALE_FIELD_MANAGER_HOW_TO})`;
}

/**
 * Refuses a server-side apply that drops a pod-list entry another field
 * manager still co-owns. The API server keeps that entry, so the sync either
 * leaves a stale container or volume running or, when the chart moved the
 * entry to another list, is rejected outright: on 2026-11-26 a `kubectl-patch`
 * owner of `containers[gluetun]` left the media comparison failing with a
 * duplicate `gluetun` once the chart made it an init container.
 *
 * Status writes and Argo's own apply are not owners that matter. Every other
 * manager, Argo's pre-server-side `argocd-application-controller` included,
 * holds the field until an operator clears it.
 */
export function staleFieldManagerFindings(
  live: Record<string, unknown>,
  target: Record<string, unknown>,
  resourceIdentity: string,
): readonly string[] {
  const managers =
    ManagedFieldsSchema.parse(live).metadata?.managedFields ?? [];
  return managers
    .filter((manager) => holdsSpecEntries(manager))
    .flatMap((manager) =>
      ownedEntries(manager.fieldsV1 ?? {}, [])
        .filter((entry) => !declaredNames(target, entry.path).has(entry.name))
        .map((entry) => strandedEntryFinding(resourceIdentity, entry, manager)),
    );
}

/**
 * The stale-manager check across an Application's revision-scoped resources.
 * Only server-side-applied resources can strand an entry, and a resource Argo
 * deletes and recreates (`Force=true,Replace=true`, or a recreated hook) is
 * never applied at all.
 */
export function staleFieldManagerResourceFindings(
  resources: readonly ManagedResource[],
  applicationServerSideApply: boolean,
): readonly string[] {
  return resources.flatMap((resource) => {
    const live = parseObject(resource.liveState, resource, "liveState");
    const target = parseObject(resource.targetState, resource, "targetState");
    if (live === null || target === null) return [];
    const options = syncOptions(target);
    const applied =
      !(options.has("Force=true") && options.has("Replace=true")) &&
      !targetIsRecreatedHook(target) &&
      resourceUsesServerSideApply(target, applicationServerSideApply);
    return applied
      ? staleFieldManagerFindings(live, target, identity(resource))
      : [];
  });
}
