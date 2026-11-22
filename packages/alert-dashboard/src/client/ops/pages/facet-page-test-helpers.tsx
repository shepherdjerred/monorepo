import type { FacetByKey, FacetKey } from "@shepherdjerred/ops-model/facets.ts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";

import { opsKeys } from "#client/ops/ops-api.ts";
import type { OpsFacetResponse } from "#shared/ops-schema";
import { InstantTextSchema } from "#shared/time";
import { FIXTURE_OPS_FACETS } from "#test-fixtures/ops-facets";

const GENERATED_AT = InstantTextSchema.parse("2026-11-21T22:30:00Z");
const RECEIVED_AT = InstantTextSchema.parse("2026-11-21T22:30:05Z");

export function requireFixtureFacet<K extends FacetKey>(key: K): FacetByKey[K] {
  const fixtures: { readonly [P in FacetKey]?: FacetByKey[P] | undefined } =
    FIXTURE_OPS_FACETS;
  const facet = fixtures[key];
  if (facet === undefined) {
    throw new Error(`FIXTURE_OPS_FACETS.${key} is missing`);
  }
  return facet;
}

export function renderSeededFacetRoute<K extends FacetKey>(options: {
  readonly key: K;
  readonly url: string;
  readonly data: FacetByKey[K] | null;
  readonly stale?: boolean;
  readonly children: ReactNode;
}): string {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const envelope: OpsFacetResponse<K> = {
    key: options.key,
    generatedAt: GENERATED_AT,
    receivedAt: RECEIVED_AT,
    stale: options.stale ?? false,
    data: options.data,
  };
  queryClient.setQueryData(opsKeys.facet(options.key), envelope);

  return renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[options.url]}>
        {options.children}
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
