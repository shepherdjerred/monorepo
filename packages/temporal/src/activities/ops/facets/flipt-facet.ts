import {
  compareManagedFlagInventory,
  fetchFliptSnapshot,
  type FliptFetcher,
} from "@shepherdjerred/feature-flags/managed-flag-drift.ts";
import {
  managedFlagInventory,
  materializeManagedNamespaceEnvironment,
  type ManagedFlag,
  type ManagedFlagInventory,
} from "@shepherdjerred/feature-flags/managed-flag-inventory.ts";
import { classifyManagedBoolean } from "@shepherdjerred/feature-flags/rollout-state.ts";
import type {
  FliptFacet,
  FliptNamespaceStatus,
} from "@shepherdjerred/ops-model/facets.ts";
import { z } from "zod";

const SNAPSHOT_TIMEOUT_MS = 4000;

function isFlagEnabled(flag: ManagedFlag): boolean {
  return flag.type === "variant" || classifyManagedBoolean(flag) !== "off";
}

async function evaluateNamespaceEnvironment(input: {
  fliptUrl: string;
  namespace: string;
  environment: "prod" | "beta";
  expected: readonly ManagedFlag[];
  fetcher: FliptFetcher;
}): Promise<FliptNamespaceStatus> {
  try {
    const snapshot = await fetchFliptSnapshot({
      url: input.fliptUrl,
      namespace: input.namespace,
      environment: input.environment,
      fetcher: (url, init) =>
        input.fetcher(url, {
          ...init,
          signal: AbortSignal.timeout(SNAPSHOT_TIMEOUT_MS),
        }),
    });
    if (snapshot.flags.length === 0 && input.expected.length > 0) {
      return "missing";
    }
    const drift = compareManagedFlagInventory(snapshot, input.expected);
    if (
      drift.missingInFlipt.length === input.expected.length &&
      input.expected.length > 0 &&
      drift.undeclaredInInventory.length === 0
    ) {
      return "missing";
    }
    return drift.missingInFlipt.length > 0 ||
      drift.undeclaredInInventory.length > 0 ||
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

export async function collectFliptFacet(options?: {
  fliptUrl?: string | undefined;
  inventory?: ManagedFlagInventory;
  fetcher?: FliptFetcher;
  now?: Date;
}): Promise<FliptFacet> {
  const inventory = options?.inventory ?? managedFlagInventory;
  const fliptUrl = (options?.fliptUrl ?? Bun.env["FLIPT_URL"] ?? "").trim();
  const fetcher: FliptFetcher =
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

  const flags: FliptFacet["flags"] = inventory.flags.map((flag) => {
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

  const namespaces: FliptFacet["namespaces"] = await Promise.all(
    inventory.namespaces.map(async (ns) => {
      const prodExpected = prodByNamespace.get(ns.key) ?? [];
      const betaExpected = betaByNamespace.get(ns.key) ?? [];
      if (fliptUrl === "") {
        return {
          namespace: ns.key,
          name: ns.name,
          flagCount: prodExpected.length,
          prodStatus: "unknown" as const,
          betaStatus: "unknown" as const,
        };
      }
      const [prodStatus, betaStatus] = await Promise.all([
        evaluateNamespaceEnvironment({
          fliptUrl,
          namespace: ns.key,
          environment: "prod",
          expected: prodExpected,
          fetcher,
        }),
        evaluateNamespaceEnvironment({
          fliptUrl,
          namespace: ns.key,
          environment: "beta",
          expected: betaExpected,
          fetcher,
        }),
      ]);
      return {
        namespace: ns.key,
        name: ns.name,
        flagCount: prodExpected.length,
        prodStatus,
        betaStatus,
      };
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
