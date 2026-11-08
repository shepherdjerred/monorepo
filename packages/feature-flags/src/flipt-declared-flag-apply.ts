import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import {
  FLIPT_FLAG_TYPE_URL,
  toFliptFlagPayload,
} from "./flipt-resource-payloads.ts";
import {
  managedFlagInventory,
  materializeManagedNamespaceEnvironment,
  type ManagedFlagInventory,
} from "./managed-flag-inventory.ts";
import type { FliptFetcher } from "./managed-flag-drift.ts";
import { validateDeclaredSegments } from "./flipt-declared-segment-preflight.ts";

const PayloadSchema = z.looseObject({
  "@type": z.literal(FLIPT_FLAG_TYPE_URL),
  key: z.string().min(1),
  type: z.literal("BOOLEAN_FLAG_TYPE"),
  enabled: z.boolean().default(false),
  rules: z.array(z.unknown()).default([]),
  rollouts: z.array(z.unknown()).default([]),
  metadata: z.record(z.string(), z.string()).default({}),
});
const ResourceSchema = z.object({
  resource: z.object({
    key: z.string(),
    namespaceKey: z.string(),
    payload: PayloadSchema,
  }),
  revision: z.string().min(1),
});
type Payload = z.infer<typeof PayloadSchema>;

export type DeclaredFlagChange = {
  key: string;
  status: "planned" | "unchanged" | "applied" | "conflict" | "failed";
  before: Payload;
  after: Payload;
  revisionBefore: string;
  revisionAfter?: string;
  error?: string;
};
export type DeclaredFlagApplyResult = {
  environment: string;
  namespace: string;
  mode: "plan" | "apply";
  changes: DeclaredFlagChange[];
};
export type DeclaredFlagApplyOptions = {
  url: string;
  environment: string;
  namespace: string;
  flagKeys: readonly string[];
  mode: "plan" | "apply";
  fetcher: FliptFetcher;
  inventory?: ManagedFlagInventory;
  /** Receives the complete before-images and proposed changes before the first write. */
  onPlan?: (plan: DeclaredFlagApplyResult) => void;
};

function behavior(payload: Payload) {
  return {
    enabled: payload.enabled,
    rules: payload.rules,
    rollouts: payload.rollouts,
  };
}

async function readResource(
  options: DeclaredFlagApplyOptions,
  endpoint: string,
  key: string,
) {
  const response = await options.fetcher(
    `${endpoint}/${encodeURIComponent(FLIPT_FLAG_TYPE_URL)}/${encodeURIComponent(key)}`,
    {
      headers: { Accept: "application/json" },
    },
  );
  if (!response.ok)
    throw new Error(
      `Cannot read declared flag ${key}: HTTP ${String(response.status)}`,
    );
  const value = ResourceSchema.parse(await response.json());
  if (
    value.resource.namespaceKey !== options.namespace ||
    value.resource.key !== key ||
    value.resource.payload.key !== key
  ) {
    throw new Error(`Declared flag resource identity differs for ${key}`);
  }
  return value;
}

async function previewDeclaredManagedFlags(options: DeclaredFlagApplyOptions) {
  if (options.flagKeys.length === 0)
    throw new Error("Explicit --flag selection is required");
  if (new Set(options.flagKeys).size !== options.flagKeys.length)
    throw new Error("Duplicate --flag selection");
  const inventory = options.inventory ?? managedFlagInventory;
  const declared = materializeManagedNamespaceEnvironment(
    inventory,
    options.environment,
    options.namespace,
  );
  const selected = options.flagKeys.map((key) => {
    const flag = declared.find((candidate) => candidate.key === key);
    if (flag?.type !== "boolean")
      throw new Error(
        `Selected key is not a declared boolean in ${options.environment}/${options.namespace}: ${key}`,
      );
    return flag;
  });
  const endpoint = `${options.url.replace(/\/$/u, "")}/api/v2/environments/${encodeURIComponent(options.environment)}/namespaces/${encodeURIComponent(options.namespace)}/resources`;
  const result: DeclaredFlagApplyResult = {
    environment: options.environment,
    namespace: options.namespace,
    mode: options.mode,
    changes: [],
  };
  let revision: string | undefined;
  // Validate every target before making any write. An unrelated key is never selected implicitly.
  for (const flag of selected) {
    const current = await readResource(options, endpoint, flag.key);
    if (revision !== undefined && current.revision !== revision)
      throw new Error(
        "Flipt revision changed during rollout preview; read and plan again",
      );
    revision = current.revision;
    const desired = toFliptFlagPayload(flag);
    const before = current.resource.payload;
    const after: Payload = {
      ...before,
      enabled: flag.default,
      rules: [...desired.rules],
      rollouts: [...desired.rollouts],
    };
    result.changes.push({
      key: flag.key,
      status: isDeepStrictEqual(behavior(before), behavior(after))
        ? "unchanged"
        : "planned",
      before,
      after,
      revisionBefore: revision,
    });
  }
  if (revision === undefined)
    throw new Error("No declared flags were previewed");
  await validateDeclaredSegments({
    flags: selected,
    endpoint,
    namespace: options.namespace,
    revision,
    fetcher: options.fetcher,
  });
  options.onPlan?.(structuredClone(result));
  return { result, endpoint, revision };
}

async function applyChange(
  options: DeclaredFlagApplyOptions,
  endpoint: string,
  change: DeclaredFlagChange,
  revision: string,
): Promise<string | undefined> {
  try {
    const response = await options.fetcher(endpoint, {
      method: "PUT",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        environmentKey: options.environment,
        namespaceKey: options.namespace,
        key: change.key,
        revision,
        payload: change.after,
      }),
    });
    if (!response.ok) {
      change.status = response.status === 409 ? "conflict" : "failed";
      change.error = `Flipt write returned HTTP ${String(response.status)}; read back before retrying`;
      return undefined;
    }
    const applied = ResourceSchema.parse(await response.json());
    if (
      applied.resource.namespaceKey !== options.namespace ||
      applied.resource.key !== change.key ||
      applied.resource.payload.key !== change.key
    )
      throw new Error(`Applied flag identity differs for ${change.key}`);
    const observed = await readResource(options, endpoint, change.key);
    change.revisionAfter = observed.revision;
    if (observed.revision !== applied.revision) {
      change.status = "conflict";
      change.error =
        "Flipt revision changed before readback; no further writes performed";
      return undefined;
    }
    if (
      !isDeepStrictEqual(
        behavior(observed.resource.payload),
        behavior(change.after),
      ) ||
      !isDeepStrictEqual(
        observed.resource.payload.metadata,
        change.before.metadata,
      )
    )
      throw new Error(`Declared flag readback differs for ${change.key}`);
    change.status = "applied";
    return observed.revision;
  } catch (error) {
    change.status = "failed";
    change.error = error instanceof Error ? error.message : String(error);
    return undefined;
  }
}

/** Operator-only, revision-guarded writes; the scheduled reconciler never calls this. */
export async function applyDeclaredManagedFlags(
  options: DeclaredFlagApplyOptions,
): Promise<DeclaredFlagApplyResult> {
  const preview = await previewDeclaredManagedFlags(options);
  const { result, endpoint } = preview;
  if (options.mode === "plan") return result;
  let revision = preview.revision;
  for (const change of result.changes) {
    if (change.status === "unchanged") continue;
    const nextRevision = await applyChange(options, endpoint, change, revision);
    if (nextRevision === undefined) break;
    revision = nextRevision;
  }
  return result;
}
