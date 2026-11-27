import { isDeepStrictEqual } from "node:util";
import { parseFlagsDeployment, validateFlagsUrl } from "./config/schema.ts";
import { flagDeployments, type FlagDeployment } from "./deployments.ts";
import type { FlagValue } from "./evaluate.ts";
import { variantValueIssues } from "./flag-write-validation.ts";
import {
  managedFlagInventory,
  managedFlagNamespaces,
  type ManagedFlagInventory,
} from "./managed-flag-inventory.ts";
import { projectDeploymentFlags } from "./project-deployment.ts";
import * as wire from "./flags-wire.ts";

// The wire schemas live in the Zod-only `flags-wire.ts` so the Flags browser
// client can share them; existing server-side importers keep these names.
export const FlagsValueSchema = wire.FlagsValueSchema;
export const FlagsDeploymentDocumentSchema = wire.FlagsDeploymentDocumentSchema;
export const FlagsDeploymentSnapshotSchema = wire.FlagsDeploymentSnapshotSchema;
export const FlagsDiffResponseSchema = wire.FlagsDiffResponseSchema;
export type FlagsDeploymentDocument = wire.FlagsDeploymentDocument;
export type FlagsDeploymentSnapshot = wire.FlagsDeploymentSnapshot;
export type FlagsDiffResponse = wire.FlagsDiffResponse;

export type FlagsHttpFetcher = (
  input: string | Request | URL,
  init?: RequestInit,
) => Promise<Response>;

export type DeploymentFlagDrift = {
  readonly missingFlags: readonly string[];
  readonly extraFlags: readonly string[];
  readonly contractMismatches: readonly string[];
};

export function normalizeFlagsBaseUrl(url: string): string {
  const problem = validateFlagsUrl(url);
  if (problem !== undefined) {
    throw new Error(problem);
  }
  return url.replace(/\/+$/u, "");
}

export function deploymentEndpointPath(deployment: FlagDeployment): string {
  const parsed = parseFlagsDeployment(deployment.id);
  if (parsed === undefined) {
    throw new Error(`Invalid flag deployment id: ${deployment.id}`);
  }
  return `/v1/deployments/${encodeURIComponent(parsed.catalog)}/${encodeURIComponent(parsed.stage)}`;
}

function assertUniqueFlagKeys(
  flags: readonly FlagValue[],
  deploymentId: string,
): void {
  const seen = new Set<string>();
  for (const flag of flags) {
    if (seen.has(flag.key)) {
      throw new Error(
        `duplicate flag key in ${deploymentId} document: ${flag.key}`,
      );
    }
    seen.add(flag.key);
  }
}

/**
 * Advisory label a machine caller sends so the Flags audit trail can tell
 * callers sharing `FLAGS_MACHINE_TOKEN` apart. It is not a credential.
 */
export const FLAGS_ACTOR_HEADER = "X-Flags-Actor";
const FLAGS_ACTOR_PATTERN = /^[a-z0-9][a-z0-9._@-]{0,63}$/u;

export type FlagsMachineFetcherOptions = {
  /** Stable caller label sent as `X-Flags-Actor` on every request. */
  readonly actor?: string;
};

/** Machine credentials are scoped to the configured Flags origin. */
export function createFlagsMachineFetcher(
  url: string,
  token: string | undefined,
  upstream: FlagsHttpFetcher = fetch,
  options: FlagsMachineFetcherOptions = {},
): FlagsHttpFetcher {
  const base = normalizeFlagsBaseUrl(url);
  if (token === undefined || token.trim() === "") {
    throw new Error(
      "FLAGS_MACHINE_TOKEN is required for Flags management operations",
    );
  }
  const { actor } = options;
  if (actor !== undefined && !FLAGS_ACTOR_PATTERN.test(actor)) {
    throw new Error(
      `Invalid Flags actor label ${JSON.stringify(actor)}: expected ${FLAGS_ACTOR_PATTERN.source}`,
    );
  }
  const origin = new URL(base).origin;
  return (input, init) => {
    const target =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    if (new URL(target).origin !== origin) {
      throw new Error("Flags machine request changed origin");
    }
    const headers = new Headers(
      input instanceof Request ? input.headers : undefined,
    );
    new Headers(init?.headers).forEach((value, key) => {
      headers.set(key, value);
    });
    headers.set("Authorization", `Bearer ${token}`);
    if (actor !== undefined) headers.set(FLAGS_ACTOR_HEADER, actor);
    return upstream(input, { ...init, headers, redirect: "error" });
  };
}

export function diffProjectedDeploymentFlags(
  deployment: FlagDeployment,
  document: {
    readonly revision: number;
    readonly flags: readonly FlagValue[];
  },
) {
  const declared = projectDeploymentFlags(deployment);
  const live = new Map(document.flags.map((flag) => [flag.key, flag]));
  const declaredKeys = new Set(declared.map((flag) => flag.key));
  return {
    id: deployment.id,
    revision: document.revision,
    missing: declared.filter((flag) => !live.has(flag.key)),
    extra: document.flags
      .filter((flag) => !declaredKeys.has(flag.key))
      .map((flag) => flag.key),
    drift: declared.flatMap((flag) => {
      const current = live.get(flag.key);
      return current === undefined || isDeepStrictEqual(current, flag)
        ? []
        : [{ key: flag.key, live: current, declared: flag }];
    }),
    invalid: invalidLiveVariants(declared, document.flags),
  };
}

/**
 * Declared variant flags whose live value fails the key's value schema. Live
 * data is reported, never trusted or thrown on: a bad value written before
 * validation existed must stay visible rather than break the diff.
 */
function invalidLiveVariants(
  declared: readonly FlagValue[],
  liveFlags: readonly FlagValue[],
) {
  const declaredVariants = new Set(
    declared.filter((flag) => flag.type === "variant").map((flag) => flag.key),
  );
  return liveFlags.flatMap((flag) => {
    if (flag.type !== "variant" || !declaredVariants.has(flag.key)) return [];
    const issues = variantValueIssues(flag.key, flag.value).map(
      ({ path, message }) => ({ path, message }),
    );
    return issues.length === 0
      ? []
      : [{ key: flag.key, value: flag.value, issues }];
  });
}

export async function fetchFlagsDeploymentSnapshot(options: {
  readonly url: string;
  readonly deployment: FlagDeployment;
  readonly fetcher?: FlagsHttpFetcher;
}): Promise<FlagsDeploymentSnapshot> {
  const base = normalizeFlagsBaseUrl(options.url);
  const fetcher: FlagsHttpFetcher =
    options.fetcher ?? ((input, init) => fetch(input, init));
  const response = await fetcher(
    `${base}${deploymentEndpointPath(options.deployment)}/snapshot`,
    {
      headers: { Accept: "application/json" },
      redirect: "error",
    },
  );
  if (!response.ok) {
    throw new Error(
      `Flags snapshot request failed for ${options.deployment.id}: HTTP ${String(response.status)}`,
    );
  }
  const parsed = FlagsDeploymentSnapshotSchema.parse(await response.json());
  if (parsed.deployment !== options.deployment.id) {
    throw new Error(
      `Flags snapshot deployment "${parsed.deployment}" did not match "${options.deployment.id}"`,
    );
  }
  assertUniqueFlagKeys(parsed.flags, options.deployment.id);
  return parsed;
}

export async function fetchFlagsDeploymentDocument(options: {
  readonly url: string;
  readonly deployment: FlagDeployment;
  readonly fetcher: FlagsHttpFetcher;
}): Promise<FlagsDeploymentDocument> {
  const base = normalizeFlagsBaseUrl(options.url);
  const response = await options.fetcher(
    `${base}${deploymentEndpointPath(options.deployment)}`,
    { headers: { Accept: "application/json" } },
  );
  if (!response.ok) {
    throw new Error(
      `Flags document read failed for ${options.deployment.id}: HTTP ${String(response.status)}`,
    );
  }
  const parsed = FlagsDeploymentDocumentSchema.parse(await response.json());
  if (parsed.id !== options.deployment.id) {
    throw new Error(
      `Flags document "${parsed.id}" did not match "${options.deployment.id}"`,
    );
  }
  assertUniqueFlagKeys(parsed.flags, options.deployment.id);
  return parsed;
}

export async function fetchFlagsDiff(options: {
  readonly url: string;
  readonly fetcher: FlagsHttpFetcher;
}): Promise<FlagsDiffResponse> {
  const base = normalizeFlagsBaseUrl(options.url);
  const response = await options.fetcher(`${base}/v1/diff`, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(
      `Flags diff request failed: HTTP ${String(response.status)}`,
    );
  }
  return FlagsDiffResponseSchema.parse(await response.json());
}

export function describeFlagValueDrift(
  declared: FlagValue,
  live: FlagValue,
): string[] {
  if (declared.type !== live.type) {
    return [
      `${declared.key}: expected type ${declared.type}, got ${live.type}`,
    ];
  }
  if (declared.type === "variant" && live.type === "variant") {
    return declared.value === live.value
      ? []
      : [
          `${declared.key}: expected default ${JSON.stringify(declared.value)}, got ${JSON.stringify(live.value)}`,
        ];
  }
  if (declared.type === "boolean" && live.type === "boolean") {
    const mismatches: string[] = [];
    if (declared.default !== live.default) {
      mismatches.push(
        `${declared.key}: expected default ${JSON.stringify(declared.default)}, got ${JSON.stringify(live.default)}`,
      );
    }
    if (!isDeepStrictEqual(declared.rollouts, live.rollouts)) {
      mismatches.push(
        `${declared.key}: rollout contract mismatch; expected ${JSON.stringify(declared.rollouts)}, got ${JSON.stringify(live.rollouts)}`,
      );
    }
    return mismatches;
  }
  return [];
}

/** One line per invalid live variant, naming each failing path. */
export function describeInvalidFlagValue(entry: {
  readonly key: string;
  readonly value: string;
  readonly issues: readonly {
    readonly path: string;
    readonly message: string;
  }[];
}): string {
  const issues = entry.issues
    .map((issue) =>
      issue.path === "" ? issue.message : `${issue.path}: ${issue.message}`,
    )
    .join("; ");
  return `${entry.key}: live value ${JSON.stringify(entry.value)} fails its value schema (${issues})`;
}

export function compareDeploymentFlags(
  liveFlags: readonly FlagValue[],
  expectedFlags: readonly FlagValue[],
): DeploymentFlagDrift {
  const expectedByKey = new Map(expectedFlags.map((flag) => [flag.key, flag]));
  const liveByKey = new Map(liveFlags.map((flag) => [flag.key, flag]));
  return {
    missingFlags: expectedFlags
      .filter((flag) => !liveByKey.has(flag.key))
      .map((flag) => flag.key)
      .toSorted(),
    extraFlags: liveFlags
      .filter((flag) => !expectedByKey.has(flag.key))
      .map((flag) => flag.key)
      .toSorted(),
    contractMismatches: expectedFlags.flatMap((expected) => {
      const live = liveByKey.get(expected.key);
      return live === undefined ? [] : describeFlagValueDrift(expected, live);
    }),
  };
}

export function formatDeploymentFlagDrift(
  drift: DeploymentFlagDrift,
): string[] {
  return [
    ...(drift.missingFlags.length === 0
      ? []
      : [`declared keys missing from Flags: ${drift.missingFlags.join(",")}`]),
    ...(drift.extraFlags.length === 0
      ? []
      : [
          `Flags keys absent from the inventory: ${drift.extraFlags.join(",")}`,
        ]),
    ...drift.contractMismatches,
  ];
}

export function selectFlagDeployments(options: {
  readonly deploymentFilter?: string | undefined;
  readonly environmentFilter?: string | undefined;
  readonly namespaceFilter?: string | undefined;
  readonly deployments?: readonly FlagDeployment[];
  readonly inventory?: ManagedFlagInventory;
}): FlagDeployment[] {
  const deployments = options.deployments ?? flagDeployments;
  const inventory = options.inventory ?? managedFlagInventory;
  if (options.deploymentFilter !== undefined) {
    if (
      options.environmentFilter !== undefined ||
      options.namespaceFilter !== undefined
    ) {
      throw new Error(
        "Choose either --deployment or --environment/--namespace filters",
      );
    }
    const found = deployments.find(
      (candidate) => candidate.id === options.deploymentFilter,
    );
    if (found === undefined) {
      throw new Error(
        `unknown flag deployment filter: ${options.deploymentFilter}`,
      );
    }
    return [found];
  }
  const knownEnvironments = inventory.environments.map((entry) => entry.key);
  if (
    options.environmentFilter !== undefined &&
    !knownEnvironments.includes(options.environmentFilter)
  ) {
    throw new Error(
      `unknown managed environment filter: ${options.environmentFilter}`,
    );
  }
  const knownNamespaces =
    inventory === managedFlagInventory
      ? managedFlagNamespaces
      : inventory.namespaces.map((entry) => entry.key);
  if (
    options.namespaceFilter !== undefined &&
    !knownNamespaces.includes(options.namespaceFilter)
  ) {
    throw new Error(
      `unknown managed namespace filter: ${options.namespaceFilter}`,
    );
  }
  const matched = deployments.filter(
    (deployment) =>
      (options.environmentFilter === undefined ||
        deployment.stage === options.environmentFilter) &&
      (options.namespaceFilter === undefined ||
        deployment.catalog === options.namespaceFilter),
  );
  if (matched.length === 0) {
    const scope = [
      ...(options.environmentFilter === undefined
        ? []
        : [options.environmentFilter]),
      ...(options.namespaceFilter === undefined
        ? []
        : [options.namespaceFilter]),
    ].join("/");
    throw new Error(`no active flag deployment matches filter: ${scope}`);
  }
  return matched;
}
