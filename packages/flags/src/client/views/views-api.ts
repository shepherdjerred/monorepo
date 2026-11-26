import { useQueries, useQuery } from "@tanstack/react-query";
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
