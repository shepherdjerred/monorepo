import type { FacetByKey, FacetKey } from "@shepherdjerred/ops-model/facets.ts";
import { useQuery } from "@tanstack/react-query";

import { facetQuery } from "#client/ops/ops-api.ts";

export function useOptionalFacet<K extends FacetKey>(
  key: K,
  enabled = true,
): FacetByKey[K] | null {
  const query = useQuery({ ...facetQuery(key), enabled });
  return query.data?.data ?? null;
}
