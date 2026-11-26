import type { LookupTarget } from "./ranking-report.ts";
import { z } from "zod";

const OSV_QUERY_BATCH = "https://api.osv.dev/v1/querybatch";
const QUERY_BATCH_SIZE = 100;

const OsvBatchSchema = z.object({
  results: z.array(
    z.object({
      vulns: z
        .array(z.object({ id: z.string().regex(/^[\w.:-]+$/u) }))
        .optional(),
      next_page_token: z.string().optional(),
    }),
  ),
});

type OsvQuery = {
  readonly package: { readonly ecosystem: string; readonly name: string };
  readonly version: string;
  readonly page_token?: string;
};

const OSV_ECOSYSTEM = new Map([
  ["crate", "crates.io"],
  ["go", "Go"],
  ["maven", "Maven"],
  ["npm", "npm"],
  ["nuget", "NuGet"],
  ["packagist", "Packagist"],
  ["pypi", "PyPI"],
  ["rubygems", "RubyGems"],
  ["swift", "SwiftURL"],
]);

function queryFor(
  target: LookupTarget,
  version: string | null,
): OsvQuery | undefined {
  const ecosystem = OSV_ECOSYSTEM.get(target.target.datasource ?? "");
  return ecosystem === undefined || version === null || version === ""
    ? undefined
    : { package: { ecosystem, name: target.lookupName }, version };
}

function queryKey(query: OsvQuery): string {
  return JSON.stringify([
    query.package.ecosystem,
    query.package.name,
    query.version,
  ]);
}

async function queryBatch(
  initialQueries: readonly OsvQuery[],
  found: Map<string, Set<string>>,
  fetchImpl: typeof fetch,
  signal?: AbortSignal,
): Promise<void> {
  let queries = initialQueries;
  while (queries.length > 0) {
    const response = await fetchImpl(OSV_QUERY_BATCH, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ queries }),
      signal:
        signal === undefined
          ? AbortSignal.timeout(20_000)
          : AbortSignal.any([signal, AbortSignal.timeout(20_000)]),
    });
    if (!response.ok)
      throw new Error(
        `OSV advisory lookup returned HTTP ${String(response.status)}`,
      );
    const { results } = OsvBatchSchema.parse(await response.json());
    if (results.length !== queries.length) {
      throw new Error(
        "OSV advisory batch response did not match its requests.",
      );
    }
    queries = results.flatMap((result, index) => {
      const query = queries[index];
      if (query === undefined)
        throw new Error("OSV advisory result has no query.");
      const key = queryKey(query);
      const ids = found.get(key) ?? new Set<string>();
      for (const advisory of result.vulns ?? []) ids.add(advisory.id);
      found.set(key, ids);
      const page = result.next_page_token;
      if (page === undefined || page === "") return [];
      if (page === query.page_token)
        throw new Error("OSV advisory pagination did not advance.");
      return [{ ...query, page_token: page }];
    });
  }
}

export type AdvisoryImpact = {
  readonly state: "assessed" | "missing-version" | "unavailable";
  readonly fixed: string[];
  readonly added: string[];
};

export async function readRenovateAdvisories(
  targets: readonly LookupTarget[],
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<ReadonlyMap<LookupTarget, AdvisoryImpact>> {
  const allQueries = new Map<string, OsvQuery>();
  const targetQueries = new Map<
    LookupTarget,
    { current: OsvQuery; next: OsvQuery }
  >();
  const impacts = new Map<LookupTarget, AdvisoryImpact>();
  for (const target of targets) {
    if (!OSV_ECOSYSTEM.has(target.target.datasource ?? "")) continue;
    const current = queryFor(target, target.installedVersion);
    const next = queryFor(target, target.target.targetVersion);
    if (current === undefined || next === undefined) {
      impacts.set(target, { state: "missing-version", fixed: [], added: [] });
      continue;
    }
    allQueries.set(queryKey(current), current);
    allQueries.set(queryKey(next), next);
    targetQueries.set(target, { current, next });
  }
  const queries = [...allQueries.values()];
  const found = new Map<string, Set<string>>();
  for (let start = 0; start < queries.length; start += QUERY_BATCH_SIZE) {
    const batchFound = new Map<string, Set<string>>();
    try {
      await queryBatch(
        queries.slice(start, start + QUERY_BATCH_SIZE),
        batchFound,
        fetchImpl,
        signal,
      );
      for (const [key, ids] of batchFound) found.set(key, ids);
    } catch {
      signal?.throwIfAborted();
      // Publishable results require both queries and all of their pages.
      // Successful earlier batches still supply evidence for other targets.
    }
  }
  for (const [target, { current, next }] of targetQueries) {
    const before = found.get(queryKey(current));
    const after = found.get(queryKey(next));
    impacts.set(
      target,
      before === undefined || after === undefined
        ? { state: "unavailable", fixed: [], added: [] }
        : {
            state: "assessed",
            fixed: [...before].filter((id) => !after.has(id)),
            added: [...after].filter((id) => !before.has(id)),
          },
    );
  }
  return impacts;
}
