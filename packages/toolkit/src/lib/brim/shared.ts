import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { resolveCredentialValues } from "#lib/credentials.ts";
import { loadToolkitConfig } from "#lib/toolkit-config.ts";
import {
  loadSnapshots,
  SnapshotCacheMissingError,
  UsageSnapshotSchema,
} from "./cache.ts";
import { writePrivateFile } from "./sync/manifest.ts";

const QuotaResponseSchema = z.object({
  version: z.literal(1),
  snapshots: z.array(UsageSnapshotSchema),
});

export class BrimServiceUnavailableError extends Error {}

export async function brimServiceRequest(
  route: string,
  options: RequestInit = {},
) {
  const config = await loadToolkitConfig();
  const url = await config.value("brimServiceUrl");
  if (url === null)
    throw new BrimServiceUnavailableError("Brim service is not configured");
  const credentials = await resolveCredentialValues(["BRIM_DEVICE_TOKEN"]);
  const token = credentials["BRIM_DEVICE_TOKEN"];
  if (token === undefined) throw new Error("Missing Brim device credential");
  const headers = new Headers(options.headers);
  headers.set("authorization", `Bearer ${token}`);
  let response: Response;
  try {
    response = await fetch(new URL(route, url), {
      ...options,
      headers,
      redirect: "error",
      signal: AbortSignal.timeout(4000),
    });
  } catch (error: unknown) {
    throw new BrimServiceUnavailableError("Brim service could not be reached", {
      cause: error,
    });
  }
  if (response.status >= 500)
    throw new BrimServiceUnavailableError(
      `Brim service returned ${String(response.status)}`,
    );
  return response;
}

export async function loadBrimRankingSnapshots(
  cachePath: string,
  useLocalFile: boolean,
) {
  if (useLocalFile) return loadSnapshots(cachePath);
  const config = await loadToolkitConfig();
  if ((await config.value("brimServiceUrl")) === null)
    return loadSnapshots(cachePath);

  const cache = path.join(
    os.homedir(),
    ".toolkit",
    "brim-service",
    "quotas.json",
  );
  let snapshots;
  try {
    const response = await brimServiceRequest("/v1/quotas");
    if (!response.ok)
      throw new Error(`Brim quota request failed (${String(response.status)})`);
    const reading = QuotaResponseSchema.parse(await response.json());
    snapshots = reading.snapshots;
    await writePrivateFile(cache, JSON.stringify(snapshots));
  } catch (error: unknown) {
    if (!(error instanceof BrimServiceUnavailableError)) throw error;
    try {
      const cached = await loadSnapshots(cache);
      snapshots = cached.map((snapshot) => ({
        ...snapshot,
        freshness: { stale: { reason: error.message } },
      }));
    } catch (cacheError: unknown) {
      if (!(cacheError instanceof SnapshotCacheMissingError)) throw cacheError;
      throw error;
    }
  }
  const shared = new Set(await config.value("brimServiceSharedProviders"));
  return snapshots.map((snapshot) =>
    shared.has(snapshot.provider) ||
    (snapshot.freshness !== undefined && "stale" in snapshot.freshness)
      ? snapshot
      : {
          ...snapshot,
          freshness: {
            stale: {
              reason: "subscription account is not verified on this device",
            },
          },
        },
  );
}
