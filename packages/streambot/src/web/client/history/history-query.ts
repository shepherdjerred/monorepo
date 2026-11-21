import { HistoryProviderSchema } from "@shepherdjerred/streambot/history/provider.ts";
import { apiUrl } from "@shepherdjerred/streambot/web/client/api.ts";
import { readOffset } from "@shepherdjerred/streambot/web/client/library/query-params.ts";
import type { HistoryProvider } from "./history-items.ts";

export type HistoryFilters = {
  readonly visibility: "mine" | "server";
  readonly provider: HistoryProvider | "";
  readonly query: string;
  readonly offset: number;
};

/** The history filters held in the address bar; a value the server would refuse reads as unset. */
export function readHistoryFilters(params: URLSearchParams): HistoryFilters {
  const provider = HistoryProviderSchema.safeParse(params.get("provider"));
  return {
    visibility: params.get("visibility") === "server" ? "server" : "mine",
    provider: provider.success ? provider.data : "",
    query: params.get("q") ?? "",
    offset: readOffset(params),
  };
}

export function historyUrl(guildId: string, filters: HistoryFilters): string {
  return apiUrl("/api/history", {
    guildId,
    visibility: filters.visibility,
    provider: filters.provider,
    query: filters.query,
    offset: filters.offset === 0 ? "" : String(filters.offset),
  });
}
