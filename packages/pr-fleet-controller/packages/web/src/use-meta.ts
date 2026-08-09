import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { z } from "zod";
import {
  RunManifestSchema,
  RunSummarySchema,
  type RunManifest,
  type RunSummary,
} from "@shepherdjerred/pr-fleet-controller/src/run-events.ts";

const MetaSchema = z.object({
  manifest: RunManifestSchema,
  summary: RunSummarySchema.nullable(),
  interactive: z.boolean(),
});

export type Meta = {
  manifest: RunManifest;
  summary: RunSummary | null;
  interactive: boolean;
};

async function fetchMeta(): Promise<Meta> {
  const response = await fetch("/api/meta");
  if (!response.ok) {
    throw new Error(`meta request failed: ${String(response.status)}`);
  }
  return MetaSchema.parse(await response.json());
}

/** Poll `/api/meta` so the header picks up `summary.json` when a run finalizes. */
export function useMeta(): UseQueryResult<Meta> {
  return useQuery({
    queryKey: ["meta"],
    queryFn: fetchMeta,
    refetchInterval: 5000,
  });
}
