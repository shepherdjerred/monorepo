import { useEffect } from "react";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { FlagsDiffResponseSchema } from "@shepherdjerred/feature-flags/flags-wire.ts";
import {
  documentQuery,
  readEndpoint,
} from "@shepherdjerred/flags/client/api.ts";
import { splitDeploymentId } from "@shepherdjerred/flags/client/model.ts";

/** Every deployment compared with the repository inventory (`GET /v1/diff`). */
export function useDrift() {
  return useQuery({
    queryKey: ["diff"],
    queryFn: () => readEndpoint("/v1/diff", FlagsDiffResponseSchema),
  });
}

/**
 * Several deployments' documents under `useDocument`'s keys, so a document
 * one view loaded is not fetched again by another. Nothing loads until
 * `enabled`.
 */
export function useDocuments(ids: readonly string[], enabled = true) {
  return useQueries({
    queries: ids.map((id) => {
      const { catalog, stage } = splitDeploymentId(id);
      return { ...documentQuery(catalog, stage), enabled };
    }),
  });
}

const ListedSchema = z.array(
  z.object({ id: z.string(), revision: z.number() }),
);
const RevisionSchema = z.object({ revision: z.number() });
const DocumentKeySchema = z.tuple([
  z.literal("document"),
  z.string(),
  z.string(),
]);

/**
 * Keeps the summaries in step with edits. The deployment list and the drift
 * report never refetch on their own; when a document arrives at a revision the
 * list does not show (someone saved), both are refreshed.
 */
export function useSummaryRefresh(): void {
  const queryClient = useQueryClient();
  useEffect(
    () =>
      queryClient.getQueryCache().subscribe((event) => {
        if (event.type !== "updated" || event.action.type !== "success") return;
        const key = DocumentKeySchema.safeParse(event.query.queryKey);
        const saved = RevisionSchema.safeParse(event.action.data);
        const listed = ListedSchema.safeParse(
          queryClient.getQueryData(["deployments"]),
        );
        if (!key.success || !saved.success || !listed.success) return;
        const [, catalog, stage] = key.data;
        const id = `${catalog}/${stage}`;
        const known = listed.data.find((entry) => entry.id === id);
        if (known === undefined || known.revision === saved.data.revision)
          return;
        void queryClient.invalidateQueries({ queryKey: ["deployments"] });
        void queryClient.invalidateQueries({ queryKey: ["diff"] });
      }),
    [queryClient],
  );
}
