import { LEGACY_OBSERVER_CONFIG } from "./config.ts";
import type { z } from "zod";
import {
  ListSchema,
  ResourceSchema,
  RESOURCE_PATHS,
  LegacyObservationError,
  type ObserverRequest,
  type Resource,
} from "./wire.ts";

function pagePath(path: string, next: string) {
  return `${path}?limit=500${next === "" ? "" : `&continue=${encodeURIComponent(next)}`}`;
}
async function readPages(input: {
  request: ObserverRequest;
  signal: AbortSignal;
  kind: string;
  path: string;
}) {
  const resources: Resource[] = [];
  let bytes = 0;
  let next = "";
  let resourceVersion: string | undefined;
  for (let page = 0; page < LEGACY_OBSERVER_CONFIG.maxPages; page++) {
    const result = await input.request(
      pagePath(input.path, next),
      input.signal,
    );
    bytes += Buffer.byteLength(JSON.stringify(result));
    if (bytes > LEGACY_OBSERVER_CONFIG.maxBytes)
      throw new LegacyObservationError("inventory_byte_limit");
    const parsed = ListSchema.safeParse(result);
    if (!parsed.success)
      throw new LegacyObservationError("inventory_schema_invalid");
    if (
      resourceVersion !== undefined &&
      resourceVersion !== parsed.data.metadata.resourceVersion
    )
      throw new LegacyObservationError("pagination_changed");
    resourceVersion = parsed.data.metadata.resourceVersion;
    if (parsed.data.kind !== `${input.kind}List`)
      throw new LegacyObservationError("inventory_kind_mismatch");
    resources.push(
      ...parsed.data.items.map((item) => normalizeListItem(item, input.kind)),
    );
    if (resources.length > LEGACY_OBSERVER_CONFIG.maxObjects)
      throw new LegacyObservationError("inventory_object_limit");
    next = parsed.data.metadata.continue ?? "";
    if (next === "") return { resources, bytes };
  }
  throw new LegacyObservationError("inventory_incomplete");
}
function normalizeListItem(
  item: z.infer<typeof ListSchema>["items"][number],
  kind: string,
) {
  if (item.kind !== undefined && item.kind !== kind)
    throw new LegacyObservationError("inventory_kind_mismatch");
  return ResourceSchema.parse({ ...item, kind });
}
export async function readInventory(
  request: ObserverRequest,
  signal: AbortSignal,
): Promise<Resource[]> {
  const resources: Resource[] = [];
  let bytes = 0;
  for (const [kind, path] of RESOURCE_PATHS) {
    if (kind === undefined || path === undefined)
      throw new Error("Invalid observer resource configuration");
    const result = await readPages({ request, signal, kind, path });
    bytes += result.bytes;
    resources.push(...result.resources);
    if (
      bytes > LEGACY_OBSERVER_CONFIG.maxBytes ||
      resources.length > LEGACY_OBSERVER_CONFIG.maxObjects
    )
      throw new LegacyObservationError("inventory_limit");
  }
  const identities = resources.map(
    (item) => `${item.kind}/${item.metadata.name}`,
  );
  if (new Set(identities).size !== identities.length)
    throw new LegacyObservationError("inventory_duplicate_identity");
  return resources;
}
