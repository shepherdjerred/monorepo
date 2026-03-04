import { z } from "zod";
import { grafanaRequest } from "./client.ts";
import { DashboardSearchResultSchema, DashboardDetailSchema } from "./schemas.ts";
import type { DashboardSearchResult, DashboardDetail } from "./types.ts";

export type SearchDashboardsOptions = {
  query?: string | undefined;
  tag?: string | undefined;
  folderUid?: string | undefined;
  limit?: number | undefined;
};

export async function searchDashboards(
  options: SearchDashboardsOptions = {},
): Promise<DashboardSearchResult[]> {
  const params: Record<string, string> = {
    type: "dash-db",
  };

  if (options.query != null && options.query.length > 0) {
    params["query"] = options.query;
  }

  if (options.tag != null && options.tag.length > 0) {
    params["tag"] = options.tag;
  }

  if (options.folderUid != null && options.folderUid.length > 0) {
    params["folderUid"] = options.folderUid;
  }

  if (options.limit != null) {
    params["limit"] = String(options.limit);
  }

  const result = await grafanaRequest(
    "/api/search",
    z.array(DashboardSearchResultSchema),
    params,
  );

  if (!result.success || result.data == null) {
    throw new Error(result.error ?? "Failed to search dashboards");
  }

  return result.data;
}

export async function getDashboard(uid: string): Promise<DashboardDetail> {
  const result = await grafanaRequest(
    `/api/dashboards/uid/${uid}`,
    DashboardDetailSchema,
  );

  if (!result.success || result.data == null) {
    throw new Error(result.error ?? "Failed to fetch dashboard");
  }

  return result.data;
}
