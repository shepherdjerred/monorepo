import { z } from "zod";
import { grafanaRequest } from "./client.ts";
import { DatasourceSchema } from "./schemas.ts";
import type { Datasource } from "./types.ts";

export async function listDatasources(): Promise<Datasource[]> {
  const result = await grafanaRequest(
    "/api/datasources",
    z.array(DatasourceSchema),
  );

  if (!result.success || result.data == null) {
    throw new Error(result.error ?? "Failed to fetch datasources");
  }

  return result.data;
}

export async function getDatasource(uid: string): Promise<Datasource> {
  const result = await grafanaRequest(
    `/api/datasources/uid/${uid}`,
    DatasourceSchema,
  );

  if (!result.success || result.data == null) {
    throw new Error(result.error ?? "Failed to fetch datasource");
  }

  return result.data;
}

export async function findDefaultDatasource(
  type: "prometheus" | "loki",
): Promise<Datasource> {
  const datasources = await listDatasources();
  const match = datasources.find((ds) => ds.type === type && ds.isDefault);

  if (match != null) {
    return match;
  }

  // Fall back to first datasource of the given type
  const fallback = datasources.find((ds) => ds.type === type);

  if (fallback != null) {
    return fallback;
  }

  throw new Error(
    `No ${type} datasource found. Available datasources: ${datasources.map((ds) => `${ds.name} (${ds.type})`).join(", ")}`,
  );
}

export async function resolveUidToId(uid: string): Promise<number> {
  const ds = await getDatasource(uid);
  return ds.id;
}
