import {
  TraceIdTextSchema,
  TracesSearchResponseSchema,
} from "@shepherdjerred/ops-model/llm-traces.ts";
import { WaypointsIcon } from "lucide-react";
import { lazy } from "react";

import type {
  ClientModule,
  ModuleSearch,
  ModuleSearchResult,
} from "#client/platform/module.ts";
import { fetchReportsJson } from "#client/reports/reports-api.ts";

const TracesListPage = lazy(async () => {
  const mod = await import("./traces-list-page.tsx");
  return { default: mod.TracesListPage };
});

const TraceDetailPage = lazy(async () => {
  const mod = await import("./trace-detail-page.tsx");
  return { default: mod.TraceDetailPage };
});

export const tracesPaletteSearch: ModuleSearch = async (query, signal) => {
  const trimmed = query.trim();
  if (trimmed === "") {
    return [];
  }

  const results: ModuleSearchResult[] = [];
  const parsedTraceId = TraceIdTextSchema.safeParse(trimmed);
  if (parsedTraceId.success) {
    const traceId = parsedTraceId.data;
    results.push({
      id: `jump-${traceId}`,
      group: "Traces",
      label: `Open trace ${traceId.slice(0, 12)}…`,
      detail: "Direct trace lookup",
      to: `/traces/${traceId}`,
    });
  }

  try {
    const response = await fetchReportsJson(
      `/api/traces/search?q=${encodeURIComponent(trimmed)}&limit=6`,
      TracesSearchResponseSchema,
      signal,
    );
    for (const item of response.items) {
      const label =
        item.workloads[0] ?? item.rootSpanName ?? item.traceId.slice(0, 12);
      const detailParts = [item.service, ...item.models.slice(0, 1)];
      results.push({
        id: `trace-${item.traceId}`,
        group: "Traces",
        label,
        detail: detailParts.join(" · "),
        to: `/traces/${item.traceId}`,
      });
    }
  } catch (error) {
    if (signal.aborted) {
      throw error;
    }
    if (!parsedTraceId.success) {
      throw error;
    }
  }

  return results;
};

export const tracesClientModule: ClientModule = {
  id: "traces",
  title: "Traces",
  icon: WaypointsIcon,
  basePath: "/traces",
  routes: [
    { path: "", page: TracesListPage },
    { path: ":traceId", page: TraceDetailPage },
  ],
  nav: [
    {
      label: "Traces",
      title: "LLM traces",
      group: "Ops",
      icon: WaypointsIcon,
      path: "",
      keywords: [
        "llm",
        "traces",
        "phoenix",
        "tempo",
        "trajectories",
        "prompts",
        "tokens",
        "agents",
      ],
    },
  ],
  search: tracesPaletteSearch,
};
