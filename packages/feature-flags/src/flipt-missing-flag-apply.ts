import { z } from "zod";
import type { FliptFetcher } from "./managed-flag-drift.ts";
import {
  managedFlagInventory,
  materializeManagedNamespaceEnvironment,
  type ManagedFlag,
  type ManagedFlagInventory,
  type ManagedNamespace,
} from "./managed-flag-inventory.ts";
import {
  collectManagedSegmentPayloads,
  FLIPT_FLAG_TYPE_URL,
  FLIPT_SEGMENT_TYPE_URL,
  toFliptFlagPayload,
  type FliptFlagPayload,
  type FliptSegmentPayload,
} from "./flipt-resource-payloads.ts";

const GRPC_ALREADY_EXISTS = 6;
const GRPC_ABORTED = 10;
const MAX_CREATE_ATTEMPTS = 3;

const FliptErrorSchema = z.object({
  code: z.number().int(),
  message: z.string(),
});

const FliptResourceSchema = z.object({
  namespaceKey: z.string(),
  key: z.string(),
});

const ListResourcesResponseSchema = z.object({
  resources: z.array(FliptResourceSchema).default([]),
  revision: z.string().min(1),
});

const ListNamespacesResponseSchema = z.object({
  items: z
    .array(
      z.object({
        key: z.string(),
      }),
    )
    .default([]),
  revision: z.string().min(1),
});

const ResourceResponseSchema = z.object({
  revision: z.string().min(1),
});

export type PlannedFliptCreate =
  | {
      readonly kind: "namespace";
      readonly key: string;
      readonly name: string;
      readonly description: string;
    }
  | {
      readonly kind: "segment";
      readonly key: string;
      readonly payload: FliptSegmentPayload;
    }
  | {
      readonly kind: "flag";
      readonly key: string;
      readonly payload: FliptFlagPayload;
    };

export type FliptMissingFlagApplyResult = {
  readonly environment: string;
  readonly namespace: string;
  readonly createdNamespaces: readonly string[];
  readonly createdSegments: readonly string[];
  readonly createdFlags: readonly string[];
};

export type ApplyMissingManagedFlagsOptions = {
  readonly url: string;
  readonly inventory?: ManagedFlagInventory;
  readonly environmentFilter?: string;
  readonly namespaceFilter?: string;
  readonly fetcher?: FliptFetcher;
};

function selectedKeys(
  keys: readonly string[],
  filter: string | undefined,
  kind: string,
): string[] {
  if (filter === undefined) return [...keys];
  if (!keys.includes(filter)) {
    throw new Error(`unknown managed ${kind} filter: ${filter}`);
  }
  return [filter];
}

export function planMissingFliptResources(input: {
  readonly namespace: ManagedNamespace;
  readonly expectedFlags: readonly ManagedFlag[];
  readonly existingNamespaceKeys: ReadonlySet<string>;
  readonly existingFlagKeys: ReadonlySet<string>;
  readonly existingSegmentKeys: ReadonlySet<string>;
}): PlannedFliptCreate[] {
  const missingFlags = input.expectedFlags.filter(
    (flag) => !input.existingFlagKeys.has(flag.key),
  );
  if (
    missingFlags.length === 0 &&
    input.existingNamespaceKeys.has(input.namespace.key)
  ) {
    return [];
  }

  const planned: PlannedFliptCreate[] = [];
  if (!input.existingNamespaceKeys.has(input.namespace.key)) {
    planned.push({
      kind: "namespace",
      key: input.namespace.key,
      name: input.namespace.name,
      description: input.namespace.description,
    });
  }

  const existingOrPlannedSegments = new Set(input.existingSegmentKeys);
  for (const segment of collectManagedSegmentPayloads(missingFlags)) {
    if (existingOrPlannedSegments.has(segment.key)) continue;
    existingOrPlannedSegments.add(segment.key);
    planned.push({ kind: "segment", key: segment.key, payload: segment });
  }
  for (const flag of missingFlags) {
    planned.push({
      kind: "flag",
      key: flag.key,
      payload: toFliptFlagPayload(flag),
    });
  }
  return planned;
}

function encodeTypeUrl(typeUrl: string): string {
  return encodeURIComponent(typeUrl);
}

function fliptError(status: number, body: unknown): Error {
  const parsed = FliptErrorSchema.safeParse(body);
  if (!parsed.success) {
    return new Error(`Flipt request failed: ${status.toString()}`);
  }
  return new Error(
    `Flipt request failed: ${status.toString()} code ${parsed.data.code.toString()} ${parsed.data.message}`,
  );
}

async function readJson(response: Response): Promise<unknown> {
  return response.json();
}

async function listNamespaces(input: {
  readonly url: string;
  readonly environment: string;
  readonly fetcher: FliptFetcher;
}): Promise<z.infer<typeof ListNamespacesResponseSchema>> {
  const response = await input.fetcher(
    `${input.url}/api/v2/environments/${encodeURIComponent(input.environment)}/namespaces`,
    { headers: { Accept: "application/json" } },
  );
  const body: unknown = await readJson(response);
  if (!response.ok) throw fliptError(response.status, body);
  return ListNamespacesResponseSchema.parse(body);
}

async function listResources(input: {
  readonly url: string;
  readonly environment: string;
  readonly namespace: string;
  readonly typeUrl: string;
  readonly fetcher: FliptFetcher;
}): Promise<z.infer<typeof ListResourcesResponseSchema>> {
  const response = await input.fetcher(
    `${input.url}/api/v2/environments/${encodeURIComponent(input.environment)}/namespaces/${encodeURIComponent(input.namespace)}/resources/${encodeTypeUrl(input.typeUrl)}`,
    { headers: { Accept: "application/json" } },
  );
  const body: unknown = await readJson(response);
  if (!response.ok) throw fliptError(response.status, body);
  return ListResourcesResponseSchema.parse(body);
}

async function postJson(input: {
  readonly url: string;
  readonly fetcher: FliptFetcher;
  readonly body: Record<string, unknown>;
}): Promise<{ readonly status: number; readonly body: unknown }> {
  const response = await input.fetcher(input.url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input.body),
  });
  return { status: response.status, body: await readJson(response) };
}

function alreadyExists(status: number, body: unknown): boolean {
  if (status !== 409) return false;
  const parsed = FliptErrorSchema.safeParse(body);
  return parsed.success && parsed.data.code === GRPC_ALREADY_EXISTS;
}

function aborted(status: number, body: unknown): boolean {
  if (status !== 409) return false;
  const parsed = FliptErrorSchema.safeParse(body);
  return parsed.success && parsed.data.code === GRPC_ABORTED;
}

async function refreshRevision(input: {
  readonly url: string;
  readonly environment: string;
  readonly namespace: string;
  readonly fetcher: FliptFetcher;
}): Promise<string> {
  const listed = await listResources({
    url: input.url,
    environment: input.environment,
    namespace: input.namespace,
    typeUrl: FLIPT_FLAG_TYPE_URL,
    fetcher: input.fetcher,
  });
  return listed.revision;
}

type CreateAttemptResult = {
  readonly status: "created" | "exists" | "aborted";
  readonly revision: string;
};

async function createPlannedResource(input: {
  readonly url: string;
  readonly environment: string;
  readonly namespace: string;
  readonly item: PlannedFliptCreate;
  readonly revision: string;
  readonly fetcher: FliptFetcher;
}): Promise<CreateAttemptResult> {
  const endpoint =
    input.item.kind === "namespace"
      ? `${input.url}/api/v2/environments/${encodeURIComponent(input.environment)}/namespaces`
      : `${input.url}/api/v2/environments/${encodeURIComponent(input.environment)}/namespaces/${encodeURIComponent(input.namespace)}/resources`;
  const body =
    input.item.kind === "namespace"
      ? {
          environmentKey: input.environment,
          key: input.item.key,
          name: input.item.name,
          description: input.item.description,
          protected: false,
          revision: input.revision,
        }
      : {
          environmentKey: input.environment,
          namespaceKey: input.namespace,
          key: input.item.key,
          payload: input.item.payload,
          revision: input.revision,
        };

  const response = await postJson({
    url: endpoint,
    fetcher: input.fetcher,
    body,
  });
  if (response.status === 200) {
    return {
      status: "created",
      revision: ResourceResponseSchema.parse(response.body).revision,
    };
  }
  if (
    alreadyExists(response.status, response.body) ||
    aborted(response.status, response.body)
  ) {
    const revision = await refreshRevision({
      url: input.url,
      environment: input.environment,
      namespace: input.namespace,
      fetcher: input.fetcher,
    });
    return {
      status: alreadyExists(response.status, response.body)
        ? "exists"
        : "aborted",
      revision,
    };
  }
  throw fliptError(response.status, response.body);
}

async function createUntilSettled(input: {
  readonly url: string;
  readonly environment: string;
  readonly namespace: string;
  readonly item: PlannedFliptCreate;
  readonly revision: string;
  readonly fetcher: FliptFetcher;
}): Promise<CreateAttemptResult> {
  let revision = input.revision;
  for (let attempt = 0; attempt < MAX_CREATE_ATTEMPTS; attempt += 1) {
    const result = await createPlannedResource({
      url: input.url,
      environment: input.environment,
      namespace: input.namespace,
      item: input.item,
      revision,
      fetcher: input.fetcher,
    });
    if (result.status !== "aborted") return result;
    revision = result.revision;
  }
  throw new Error(
    `Flipt create aborted after retries: ${input.item.kind} ${input.item.key}`,
  );
}

function recordCreated(
  item: PlannedFliptCreate,
  createdNamespaces: string[],
  createdSegments: string[],
  createdFlags: string[],
): void {
  if (item.kind === "namespace") createdNamespaces.push(item.key);
  if (item.kind === "segment") createdSegments.push(item.key);
  if (item.kind === "flag") createdFlags.push(item.key);
}

async function applyPlan(input: {
  readonly url: string;
  readonly environment: string;
  readonly namespace: string;
  readonly plan: readonly PlannedFliptCreate[];
  readonly revision: string;
  readonly fetcher: FliptFetcher;
}): Promise<FliptMissingFlagApplyResult> {
  const createdNamespaces: string[] = [];
  const createdSegments: string[] = [];
  const createdFlags: string[] = [];
  let revision = input.revision;

  for (const item of input.plan) {
    const result = await createUntilSettled({
      url: input.url,
      environment: input.environment,
      namespace: input.namespace,
      item,
      revision,
      fetcher: input.fetcher,
    });
    revision = result.revision;
    if (result.status === "created") {
      recordCreated(item, createdNamespaces, createdSegments, createdFlags);
    }
  }

  return {
    environment: input.environment,
    namespace: input.namespace,
    createdNamespaces,
    createdSegments,
    createdFlags,
  };
}

async function applyNamespace(input: {
  readonly url: string;
  readonly inventory: ManagedFlagInventory;
  readonly environment: string;
  readonly namespace: ManagedNamespace;
  readonly fetcher: FliptFetcher;
}): Promise<FliptMissingFlagApplyResult> {
  const expectedFlags = materializeManagedNamespaceEnvironment(
    input.inventory,
    input.environment,
    input.namespace.key,
  );
  const [namespaces, flags, segments] = await Promise.all([
    listNamespaces({
      url: input.url,
      environment: input.environment,
      fetcher: input.fetcher,
    }),
    listResources({
      url: input.url,
      environment: input.environment,
      namespace: input.namespace.key,
      typeUrl: FLIPT_FLAG_TYPE_URL,
      fetcher: input.fetcher,
    }),
    listResources({
      url: input.url,
      environment: input.environment,
      namespace: input.namespace.key,
      typeUrl: FLIPT_SEGMENT_TYPE_URL,
      fetcher: input.fetcher,
    }),
  ]);
  const plan = planMissingFliptResources({
    namespace: input.namespace,
    expectedFlags,
    existingNamespaceKeys: new Set(namespaces.items.map((item) => item.key)),
    existingFlagKeys: new Set(flags.resources.map((resource) => resource.key)),
    existingSegmentKeys: new Set(
      segments.resources.map((resource) => resource.key),
    ),
  });
  if (plan.length === 0) {
    return {
      environment: input.environment,
      namespace: input.namespace.key,
      createdNamespaces: [],
      createdSegments: [],
      createdFlags: [],
    };
  }
  return applyPlan({
    url: input.url,
    environment: input.environment,
    namespace: input.namespace.key,
    plan,
    revision: flags.revision,
    fetcher: input.fetcher,
  });
}

export async function applyMissingManagedFlags(
  options: ApplyMissingManagedFlagsOptions,
): Promise<FliptMissingFlagApplyResult[]> {
  const inventory = options.inventory ?? managedFlagInventory;
  const fetcher: FliptFetcher =
    options.fetcher ?? ((input, init) => fetch(input, init));
  const url = options.url.replace(/\/$/u, "");
  const environments = selectedKeys(
    inventory.environments.map((environment) => environment.key),
    options.environmentFilter,
    "environment",
  );
  const namespaces = selectedKeys(
    inventory.namespaces.map((namespace) => namespace.key),
    options.namespaceFilter,
    "namespace",
  );

  const results: FliptMissingFlagApplyResult[] = [];
  for (const environment of environments) {
    for (const namespaceKey of namespaces) {
      const namespace = inventory.namespaces.find(
        (candidate) => candidate.key === namespaceKey,
      );
      if (namespace === undefined) {
        throw new Error(`unknown managed namespace: ${namespaceKey}`);
      }
      results.push(
        await applyNamespace({
          url,
          inventory,
          environment,
          namespace,
          fetcher,
        }),
      );
    }
  }
  return results;
}
