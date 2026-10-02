import { z } from "zod";
import type { FliptFetcher } from "./managed-flag-drift.ts";
import {
  managedFlagInventory,
  materializeManagedNamespaceEnvironment,
  type ManagedFlagInventory,
} from "./managed-flag-inventory.ts";
import { FLIPT_FLAG_TYPE_URL } from "./flipt-resource-payloads.ts";
import { retiredFlagDeclarations } from "./retired-flag-declarations.ts";

const MAX_DELETE_ATTEMPTS = 3;
const ListFlagsSchema = z.object({
  resources: z
    .array(z.object({ namespaceKey: z.string(), key: z.string() }))
    .default([]),
  revision: z.string().min(1),
});
const RevisionSchema = z.object({ revision: z.string().min(1) });
const FliptErrorSchema = z.object({
  code: z.number().int(),
  message: z.string(),
});

export type FliptFlagRetirementResult = {
  readonly environment: string;
  readonly namespace: string;
  readonly retiredFlags: readonly string[];
};

type Retirement = (typeof retiredFlagDeclarations)[number];

/** Refuse the whole operation before I/O if a retired flag is declared again. */
export function assertRetiredFlagsAreUnmanaged(
  inventory: ManagedFlagInventory,
): void {
  for (const declaration of retiredFlagDeclarations) {
    const managed = materializeManagedNamespaceEnvironment(
      inventory,
      declaration.environment,
      declaration.namespace,
    );
    if (managed.some((flag) => flag.key === declaration.key)) {
      throw new Error(
        `Refusing to retire managed flag ${declaration.environment}/${declaration.namespace}/${declaration.key}`,
      );
    }
  }
}

function resourceListUrl(url: string, declaration: Retirement): string {
  return `${url}/api/v2/environments/${encodeURIComponent(declaration.environment)}/namespaces/${encodeURIComponent(declaration.namespace)}/resources/${encodeURIComponent(FLIPT_FLAG_TYPE_URL)}`;
}

function requestError(status: number, body: unknown): Error {
  const parsed = FliptErrorSchema.safeParse(body);
  return parsed.success
    ? new Error(
        `Flipt retirement failed: HTTP ${String(status)} code ${String(parsed.data.code)} ${parsed.data.message}`,
      )
    : new Error(`Flipt retirement failed: HTTP ${String(status)}`);
}

async function listFlags(
  url: string,
  declaration: Retirement,
  fetcher: FliptFetcher,
) {
  const response = await fetcher(resourceListUrl(url, declaration), {
    headers: { Accept: "application/json" },
  });
  const body: unknown = await response.json();
  if (!response.ok) throw requestError(response.status, body);
  const listed = ListFlagsSchema.parse(body);
  if (
    listed.resources.some(
      (resource) => resource.namespaceKey !== declaration.namespace,
    )
  ) {
    throw new Error(
      "Flipt returned resources outside the retirement namespace",
    );
  }
  return listed;
}

function retirementOutcome(
  response: Response,
  body: unknown,
): "removed" | "already-removed" | "revision-conflict" {
  if (response.ok) {
    RevisionSchema.parse(body);
    return "removed";
  }
  const failure = FliptErrorSchema.safeParse(body);
  if (failure.success) {
    if (response.status === 409 && failure.data.code === 10)
      return "revision-conflict";
    if (response.status === 404 && failure.data.code === 5)
      return "already-removed";
  }
  throw requestError(response.status, body);
}

async function retireFlag(
  url: string,
  declaration: Retirement,
  fetcher: FliptFetcher,
): Promise<boolean> {
  for (let attempt = 0; attempt < MAX_DELETE_ATTEMPTS; attempt += 1) {
    const listed = await listFlags(url, declaration, fetcher);
    if (!listed.resources.some((resource) => resource.key === declaration.key))
      return false;
    // Flipt v2's resource DELETE uses the revision query parameter for
    // optimistic concurrency. Only this explicit declaration can be deleted.
    const endpoint = `${resourceListUrl(url, declaration)}/${encodeURIComponent(declaration.key)}?revision=${encodeURIComponent(listed.revision)}`;
    const response = await fetcher(endpoint, {
      method: "DELETE",
      headers: { Accept: "application/json" },
    });
    const body: unknown = await response.json();
    const outcome = retirementOutcome(response, body);
    if (outcome === "revision-conflict") continue;
    // A concurrent removal is settled only after a successful fresh read.
    const verified = await listFlags(url, declaration, fetcher);
    if (
      verified.resources.some((resource) => resource.key === declaration.key)
    ) {
      throw new Error(
        `Flipt retired flag is still present: ${declaration.key}`,
      );
    }
    return outcome === "removed";
  }
  throw new Error(
    `Flipt retirement revision conflict after ${String(MAX_DELETE_ATTEMPTS)} attempts: ${declaration.key}`,
  );
}

/** Finite source-owned retirement; unrelated undeclared resources are retained. */
export async function applyRetiredManagedFlags(options: {
  readonly url: string;
  readonly inventory?: ManagedFlagInventory;
  readonly fetcher?: FliptFetcher;
}): Promise<FliptFlagRetirementResult[]> {
  assertRetiredFlagsAreUnmanaged(options.inventory ?? managedFlagInventory);
  const url = options.url.replace(/\/$/u, "");
  const fetcher: FliptFetcher =
    options.fetcher ?? ((input, init) => fetch(input, init));
  const results = new Map<
    string,
    { environment: string; namespace: string; retiredFlags: string[] }
  >();
  for (const declaration of retiredFlagDeclarations) {
    const pair = `${declaration.environment}/${declaration.namespace}`;
    let result = results.get(pair);
    if (result === undefined) {
      result = {
        environment: declaration.environment,
        namespace: declaration.namespace,
        retiredFlags: [],
      };
      results.set(pair, result);
    }
    if (await retireFlag(url, declaration, fetcher))
      result.retiredFlags.push(declaration.key);
  }
  return [...results.values()];
}
