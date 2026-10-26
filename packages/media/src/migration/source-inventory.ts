import { z } from "zod";
import type { FetchTransport } from "#integrations/http.ts";
import {
  SourceInventorySchema,
  type SourceInventory,
} from "#domain/resolved-contract.ts";
import { snapshotHash } from "./profile-import.ts";

export type InventorySource = {
  source: "radarr" | "sonarr";
  baseUrl: string;
  apiKey: string;
};
export function inventoryUrl(baseUrl: string, endpoint: string): URL {
  const url = new URL(baseUrl);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== ""
  )
    throw new Error("Invalid source URL");
  url.pathname = `${url.pathname.replace(/\/$/u, "")}/api/v3/${endpoint}`;
  return url;
}
async function get(
  source: InventorySource,
  endpoint: string,
  fetcher: FetchTransport,
): Promise<unknown> {
  try {
    const response = await fetcher(inventoryUrl(source.baseUrl, endpoint), {
      method: "GET",
      redirect: "error",
      headers: { "X-Api-Key": source.apiKey },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error("Source response failed");
    const reader = response.body?.getReader();
    if (reader === undefined) throw new Error("Source response empty");
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        size += next.value.length;
        if (size > 10_000_000) throw new Error("Source response too large");
        chunks.push(next.value);
      }
    } finally {
      await reader.cancel();
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error(
      `Read-only ${source.source} inventory failed at ${endpoint}`,
    );
  }
}
async function capture(
  source: InventorySource,
  fetcher: FetchTransport,
): Promise<SourceInventory> {
  const [profiles, customFormats, qualityDefinitions, status, management] =
    await Promise.all(
      [
        "qualityprofile",
        "customformat",
        "qualitydefinition",
        "system/status",
        "config/mediamanagement",
      ].map(async (endpoint) => await get(source, endpoint, fetcher)),
    );
  // Boundary schemas strip unknown fields, including source configuration and credentials.
  return SourceInventorySchema.parse({
    source: source.source,
    version: z.object({ version: z.string() }).parse(status).version,
    properPreference: z
      .object({
        downloadPropersAndRepacks: SourceInventorySchema.shape.properPreference,
      })
      .parse(management).downloadPropersAndRepacks,
    profiles,
    customFormats,
    qualityDefinitions,
  });
}
/** Two equal consecutive captures prevent silently combining profiles from a concurrent source edit. */
export async function inventoryProfiles(
  source: InventorySource,
  fetcher: FetchTransport = fetch,
): Promise<SourceInventory> {
  const first = await capture(source, fetcher);
  const second = await capture(source, fetcher);
  if (
    snapshotHash(z.json().parse(first)) !== snapshotHash(z.json().parse(second))
  )
    throw new Error(
      `${source.source} settings changed during inventory; retry the read`,
    );
  return second;
}
