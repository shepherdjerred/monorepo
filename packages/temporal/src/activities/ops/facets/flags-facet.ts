import {
  flagDeploymentForSelector,
  type FlagDeployment,
} from "@shepherdjerred/feature-flags/deployments.ts";
import {
  compareDeploymentFlags,
  fetchFlagsDeploymentSnapshot,
  type FlagsHttpFetcher,
} from "@shepherdjerred/feature-flags/flags-drift.ts";
import {
  managedFlagInventory,
  materializeManagedNamespaceEnvironment,
  type ManagedFlag,
  type ManagedFlagInventory,
} from "@shepherdjerred/feature-flags/managed-flag-inventory.ts";
import { projectDeploymentFlags } from "@shepherdjerred/feature-flags/project-deployment.ts";
import { classifyManagedBoolean } from "@shepherdjerred/feature-flags/rollout-state.ts";
import type {
  FlagsFacet,
  FlagsNamespaceStatus,
} from "@shepherdjerred/ops-model/facets.ts";
import { z } from "zod";

const SNAPSHOT_TIMEOUT_MS = 4000;

function isFlagEnabled(flag: ManagedFlag): boolean {
  return flag.type === "variant" || classifyManagedBoolean(flag) !== "off";
}

async function evaluateDeployment(input: {
  flagsUrl: string;
  deployment: FlagDeployment;
  inventory: ManagedFlagInventory;
  fetcher: FlagsHttpFetcher;
}): Promise<FlagsNamespaceStatus> {
  const expected = projectDeploymentFlags(input.deployment, input.inventory);
  try {
    const snapshot = await fetchFlagsDeploymentSnapshot({
      url: input.flagsUrl,
      deployment: input.deployment,
      fetcher: (url, init) =>
        input.fetcher(url, {
          ...init,
          signal: AbortSignal.timeout(SNAPSHOT_TIMEOUT_MS),
        }),
    });
    if (snapshot.flags.length === 0 && expected.length > 0) {
      return "missing";
    }
    const drift = compareDeploymentFlags(snapshot.flags, expected);
    if (
      drift.missingFlags.length === expected.length &&
      expected.length > 0 &&
      drift.extraFlags.length === 0
    ) {
      return "missing";
    }
    return drift.missingFlags.length > 0 ||
      drift.extraFlags.length > 0 ||
      drift.contractMismatches.length > 0
      ? "drift"
      : "ok";
  } catch (error: unknown) {
    if (error instanceof z.ZodError || error instanceof SyntaxError) {
      throw error;
    }
    const message = error instanceof Error ? error.message : String(error);
    return /\b404\b/u.test(message) ? "missing" : "unknown";
  }
}

export async function collectFlagsFacet(options?: {
  flagsUrl?: string | undefined;
  inventory?: ManagedFlagInventory;
  fetcher?: FlagsHttpFetcher;
  now?: Date;
}): Promise<FlagsFacet> {
  const inventory = options?.inventory ?? managedFlagInventory;
  const flagsUrl = (options?.flagsUrl ?? Bun.env["FLAGS_URL"] ?? "").trim();
  const fetcher: FlagsHttpFetcher =
    options?.fetcher ?? ((input, init) => fetch(input, init));
  const todayIso = (options?.now ?? new Date()).toISOString().slice(0, 10);

  const prodByKey = new Map<string, ManagedFlag>();
  const betaByKey = new Map<string, ManagedFlag>();
  const prodByNamespace = new Map<string, ManagedFlag[]>();
  const betaByNamespace = new Map<string, ManagedFlag[]>();

  for (const ns of inventory.namespaces) {
    const prodFlags = materializeManagedNamespaceEnvironment(
      inventory,
      "prod",
      ns.key,
    );
    const betaFlags = materializeManagedNamespaceEnvironment(
      inventory,
      "beta",
      ns.key,
    );
    prodByNamespace.set(ns.key, prodFlags);
    betaByNamespace.set(ns.key, betaFlags);
    for (const flag of prodFlags) {
      prodByKey.set(flag.key, flag);
    }
    for (const flag of betaFlags) {
      betaByKey.set(flag.key, flag);
    }
  }

  let prodEnabledCount = 0;
  let betaEnabledCount = 0;
  let defaultOffExceptionsCount = 0;
  let overdueExceptionsCount = 0;

  const flags: FlagsFacet["flags"] = inventory.flags.map((flag) => {
    const prodFlag = prodByKey.get(flag.key) ?? flag;
    const betaFlag = betaByKey.get(flag.key) ?? flag;
    const prodEnabled = isFlagEnabled(prodFlag);
    const betaEnabled = isFlagEnabled(betaFlag);
    if (prodEnabled) {
      prodEnabledCount += 1;
    }
    if (betaEnabled) {
      betaEnabledCount += 1;
    }

    const exceptions =
      flag.type === "boolean" ? (flag.defaultOffExceptions ?? []) : [];
    defaultOffExceptionsCount += exceptions.length;
    for (const ex of exceptions) {
      if (ex.reviewBy !== undefined && ex.reviewBy < todayIso) {
        overdueExceptionsCount += 1;
      }
    }
    const reviewDates = exceptions
      .flatMap((ex) => (ex.reviewBy === undefined ? [] : [ex.reviewBy]))
      .sort((a, b) => a.localeCompare(b));
    const earliestReviewBy = reviewDates[0];
    const firstReason = exceptions[0]?.reason;

    return {
      namespace: flag.namespace,
      key: flag.key,
      prodEnabled,
      betaEnabled,
      ...(firstReason === undefined ? {} : { defaultOffReason: firstReason }),
      ...(earliestReviewBy === undefined ? {} : { reviewBy: earliestReviewBy }),
    };
  });

  if (flagsUrl === "") {
    return {
      totalFlags: inventory.flags.length,
      prodEnabledCount,
      betaEnabledCount,
      defaultOffExceptionsCount,
      overdueExceptionsCount,
      namespaces: inventory.namespaces.map((ns) => ({
        namespace: ns.key,
        name: ns.name,
        flagCount: (prodByNamespace.get(ns.key) ?? []).length,
        prodStatus: "unknown" as const,
        betaStatus: "unknown" as const,
      })),
      flags,
    };
  }

  const activeTargets = inventory.namespaces.flatMap((ns) =>
    (["prod", "beta"] as const).flatMap((stage) => {
      const deployment = flagDeploymentForSelector(ns.key, stage);
      return deployment === undefined
        ? []
        : [{ selector: `${ns.key}:${stage}`, deployment }];
    }),
  );
  const evaluated = await Promise.all(
    activeTargets.map(async (target) => ({
      selector: target.selector,
      status: await evaluateDeployment({
        flagsUrl,
        deployment: target.deployment,
        inventory,
        fetcher,
      }),
    })),
  );
  const statusBySelector = new Map(
    evaluated.map((entry) => [entry.selector, entry.status]),
  );
  const undeployedStatus: FlagsNamespaceStatus = evaluated.some(
    (entry) => entry.status !== "unknown",
  )
    ? "ok"
    : "unknown";

  const namespaces: FlagsFacet["namespaces"] = inventory.namespaces.map(
    (ns) => ({
      namespace: ns.key,
      name: ns.name,
      flagCount: (prodByNamespace.get(ns.key) ?? []).length,
      prodStatus: statusBySelector.get(`${ns.key}:prod`) ?? undeployedStatus,
      betaStatus: statusBySelector.get(`${ns.key}:beta`) ?? undeployedStatus,
    }),
  );

  return {
    totalFlags: inventory.flags.length,
    prodEnabledCount,
    betaEnabledCount,
    defaultOffExceptionsCount,
    overdueExceptionsCount,
    namespaces,
    flags,
  };
}
