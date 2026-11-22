import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { flagDeployments, type FlagDeployment } from "./deployments.ts";
import type { FlagValue } from "./evaluate.ts";
import {
  deploymentEndpointPath,
  fetchFlagsDeploymentDocument,
  fetchFlagsDeploymentSnapshot,
  normalizeFlagsBaseUrl,
  type FlagsHttpFetcher,
} from "./flags-drift.ts";
import { assertRetiredFlagsAreUnmanaged } from "./flipt-retired-flag-apply.ts";
import {
  managedFlagInventory,
  type ManagedFlagInventory,
} from "./managed-flag-inventory.ts";
import { projectDeploymentFlags } from "./project-deployment.ts";
import { retiredFlagDeclarations } from "./retired-flag-declarations.ts";

const MAX_RETIRE_ATTEMPTS = 3;

const RevisionResponseSchema = z.strictObject({
  revision: z.number().int().nonnegative(),
});

const CreateMissingResponseSchema = z.strictObject({
  revision: z.number().int().nonnegative(),
  created: z.array(z.string().min(1)),
});

const ErrorBodySchema = z.object({
  error: z.string(),
});

export type FlagsRetirementResult = {
  readonly deployment: string;
  readonly retiredFlags: readonly string[];
};

export type FlagsMissingApplyResult = {
  readonly deployment: string;
  readonly revision: number;
  readonly createdFlags: readonly string[];
};

export type DeclaredDeploymentFlagChange = {
  key: string;
  status: "planned" | "unchanged" | "applied" | "conflict" | "failed";
  before: FlagValue | null;
  after: FlagValue;
  revisionBefore: number;
  revisionAfter?: number;
  error?: string;
};

export type DeclaredDeploymentApplyResult = {
  deployment: string;
  mode: "plan" | "apply";
  changes: DeclaredDeploymentFlagChange[];
};

export type DeclaredDeploymentApplyOptions = {
  readonly url: string;
  readonly deployment: FlagDeployment;
  readonly flagKeys: readonly string[];
  readonly mode: "plan" | "apply";
  /** Authenticated machine fetcher; required in `apply` mode, optional in `plan`. */
  readonly fetcher?: FlagsHttpFetcher;
  /** Optional unauthenticated snapshot fetcher override for `plan` tests. */
  readonly snapshotFetcher?: FlagsHttpFetcher;
  readonly inventory?: ManagedFlagInventory;
  readonly onPlan?: (plan: DeclaredDeploymentApplyResult) => void;
};

async function readErrorDetail(response: Response): Promise<string> {
  try {
    const parsed = ErrorBodySchema.safeParse(await response.json());
    return parsed.success ? ` (${parsed.data.error})` : "";
  } catch {
    return "";
  }
}

function retiredKeysForDeployment(deployment: FlagDeployment): string[] {
  return [
    ...new Set(
      retiredFlagDeclarations
        .filter(
          (declaration) =>
            declaration.namespace === deployment.catalog &&
            declaration.environment === deployment.fliptEnvironment,
        )
        .map((declaration) => declaration.key),
    ),
  ];
}

async function retireDeploymentKeys(options: {
  readonly base: string;
  readonly deployment: FlagDeployment;
  readonly candidateKeys: readonly string[];
  readonly fetcher: FlagsHttpFetcher;
}): Promise<readonly string[]> {
  if (options.candidateKeys.length === 0) return [];
  const endpoint = `${options.base}${deploymentEndpointPath(options.deployment)}/retire`;
  for (let attempt = 0; attempt < MAX_RETIRE_ATTEMPTS; attempt += 1) {
    const current = await fetchFlagsDeploymentDocument({
      url: options.base,
      deployment: options.deployment,
      fetcher: options.fetcher,
    });
    const presentSet = new Set(current.flags.map((flag) => flag.key));
    const presentKeys = options.candidateKeys.filter((key) =>
      presentSet.has(key),
    );
    if (presentKeys.length === 0) return [];

    const response = await options.fetcher(endpoint, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        expectedRevision: current.revision,
        keys: presentKeys,
      }),
    });
    if (response.status === 409) continue;
    if (!response.ok) {
      const detail = await readErrorDetail(response);
      throw new Error(
        `Flags retirement failed in ${options.deployment.id}: HTTP ${String(response.status)}${detail}`,
      );
    }
    RevisionResponseSchema.parse(await response.json());
    const verified = await fetchFlagsDeploymentDocument({
      url: options.base,
      deployment: options.deployment,
      fetcher: options.fetcher,
    });
    const remaining = presentKeys.filter((key) =>
      verified.flags.some((flag) => flag.key === key),
    );
    if (remaining.length > 0) {
      throw new Error(
        `Flags retired key is still present in ${options.deployment.id}: ${remaining.join(",")}`,
      );
    }
    return presentKeys;
  }
  throw new Error(
    `Flags retirement conflict after ${String(MAX_RETIRE_ATTEMPTS)} attempts in ${options.deployment.id}`,
  );
}

/** Retires declared unused keys from active deployments without touching unmanaged keys. */
export async function applyRetiredDeploymentFlags(options: {
  readonly url: string;
  readonly fetcher: FlagsHttpFetcher;
  readonly inventory?: ManagedFlagInventory;
  readonly deployments?: readonly FlagDeployment[];
}): Promise<FlagsRetirementResult[]> {
  const inventory = options.inventory ?? managedFlagInventory;
  assertRetiredFlagsAreUnmanaged(inventory);
  const base = normalizeFlagsBaseUrl(options.url);
  const deployments = options.deployments ?? flagDeployments;
  const results: FlagsRetirementResult[] = [];
  for (const deployment of deployments) {
    const retiredFlags = await retireDeploymentKeys({
      base,
      deployment,
      candidateKeys: retiredKeysForDeployment(deployment),
      fetcher: options.fetcher,
    });
    results.push({ deployment: deployment.id, retiredFlags });
  }
  return results;
}

/** Inserts absent declared keys across selected deployments without overwriting live values. */
export async function applyMissingDeploymentFlags(options: {
  readonly url: string;
  readonly fetcher: FlagsHttpFetcher;
  readonly inventory?: ManagedFlagInventory;
  readonly deployments?: readonly FlagDeployment[];
}): Promise<FlagsMissingApplyResult[]> {
  const inventory = options.inventory ?? managedFlagInventory;
  const base = normalizeFlagsBaseUrl(options.url);
  const deployments = options.deployments ?? flagDeployments;
  const results: FlagsMissingApplyResult[] = [];
  for (const deployment of deployments) {
    const projected = projectDeploymentFlags(deployment, inventory);
    if (projected.length === 0) {
      const current = await fetchFlagsDeploymentDocument({
        url: base,
        deployment,
        fetcher: options.fetcher,
      });
      results.push({
        deployment: deployment.id,
        revision: current.revision,
        createdFlags: [],
      });
      continue;
    }
    const response = await options.fetcher(
      `${base}${deploymentEndpointPath(deployment)}/create-missing`,
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ flags: projected }),
      },
    );
    if (!response.ok) {
      const detail = await readErrorDetail(response);
      throw new Error(
        `Flags create-missing failed in ${deployment.id}: HTTP ${String(response.status)}${detail}`,
      );
    }
    const parsed = CreateMissingResponseSchema.parse(await response.json());
    results.push({
      deployment: deployment.id,
      revision: parsed.revision,
      createdFlags: parsed.created,
    });
  }
  return results;
}

async function readDeploymentForRollout(
  base: string,
  options: DeclaredDeploymentApplyOptions,
): Promise<{
  readonly revision: number;
  readonly flags: readonly FlagValue[];
}> {
  if (options.fetcher !== undefined) {
    return fetchFlagsDeploymentDocument({
      url: base,
      deployment: options.deployment,
      fetcher: options.fetcher,
    });
  }
  return fetchFlagsDeploymentSnapshot({
    url: base,
    deployment: options.deployment,
    ...(options.snapshotFetcher === undefined
      ? {}
      : { fetcher: options.snapshotFetcher }),
  });
}

function selectDeclaredTargets(
  options: DeclaredDeploymentApplyOptions,
  inventory: ManagedFlagInventory,
): FlagValue[] {
  if (options.flagKeys.length === 0) {
    throw new Error("Explicit --flag selection is required");
  }
  if (new Set(options.flagKeys).size !== options.flagKeys.length) {
    throw new Error("Duplicate --flag selection");
  }
  const declared = projectDeploymentFlags(options.deployment, inventory);
  return options.flagKeys.map((key) => {
    const found = declared.find((candidate) => candidate.key === key);
    if (found === undefined) {
      throw new Error(
        `Selected key is not declared in ${options.deployment.id}: ${key}`,
      );
    }
    return found;
  });
}

function markChangesFailed(
  changes: DeclaredDeploymentFlagChange[],
  status: "conflict" | "failed",
  error: string,
  revisionAfter?: number,
): void {
  for (const change of changes) {
    change.status = status;
    change.error = error;
    if (revisionAfter !== undefined) change.revisionAfter = revisionAfter;
  }
}

async function commitDeclaredChanges(input: {
  readonly base: string;
  readonly deployment: FlagDeployment;
  readonly expectedRevision: number;
  readonly planned: DeclaredDeploymentFlagChange[];
  readonly fetcher: FlagsHttpFetcher;
}): Promise<void> {
  const endpoint = `${input.base}${deploymentEndpointPath(input.deployment)}/apply`;
  try {
    const response = await input.fetcher(endpoint, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        expectedRevision: input.expectedRevision,
        flags: input.planned.map((change) => change.after),
      }),
    });
    if (!response.ok) {
      markChangesFailed(
        input.planned,
        response.status === 409 ? "conflict" : "failed",
        `Flags write returned HTTP ${String(response.status)}; read back before retrying`,
      );
      return;
    }
    const applied = RevisionResponseSchema.parse(await response.json());
    const observed = await fetchFlagsDeploymentDocument({
      url: input.base,
      deployment: input.deployment,
      fetcher: input.fetcher,
    });
    if (observed.revision !== applied.revision) {
      markChangesFailed(
        input.planned,
        "conflict",
        "Flags revision changed before readback; verify deployment state",
        observed.revision,
      );
      return;
    }
    const observedByKey = new Map(
      observed.flags.map((flag) => [flag.key, flag]),
    );
    for (const change of input.planned) {
      change.revisionAfter = observed.revision;
      if (isDeepStrictEqual(observedByKey.get(change.key), change.after)) {
        change.status = "applied";
      } else {
        change.status = "failed";
        change.error = `Declared flag readback differs for ${change.key}`;
      }
    }
  } catch (error) {
    markChangesFailed(
      input.planned,
      "failed",
      error instanceof Error ? error.message : String(error),
    );
  }
}

/** Operator-only revision-guarded writes with post-write readback verification. */
export async function applyDeclaredDeploymentFlags(
  options: DeclaredDeploymentApplyOptions,
): Promise<DeclaredDeploymentApplyResult> {
  if (options.mode === "apply" && options.fetcher === undefined) {
    throw new Error(
      "FLAGS_MACHINE_TOKEN is required for --apply-declared operations",
    );
  }
  const inventory = options.inventory ?? managedFlagInventory;
  const base = normalizeFlagsBaseUrl(options.url);
  const selected = selectDeclaredTargets(options, inventory);
  const current = await readDeploymentForRollout(base, options);
  const liveByKey = new Map(current.flags.map((flag) => [flag.key, flag]));
  const result: DeclaredDeploymentApplyResult = {
    deployment: options.deployment.id,
    mode: options.mode,
    changes: selected.map((desired) => {
      const before = liveByKey.get(desired.key) ?? null;
      return {
        key: desired.key,
        status:
          before !== null && isDeepStrictEqual(before, desired)
            ? "unchanged"
            : "planned",
        before,
        after: desired,
        revisionBefore: current.revision,
      };
    }),
  };
  options.onPlan?.(structuredClone(result));
  if (options.mode === "plan" || options.fetcher === undefined) return result;
  const planned = result.changes.filter(
    (change) => change.status === "planned",
  );
  if (planned.length === 0) return result;
  await commitDeclaredChanges({
    base,
    deployment: options.deployment,
    expectedRevision: current.revision,
    planned,
    fetcher: options.fetcher,
  });
  return result;
}
