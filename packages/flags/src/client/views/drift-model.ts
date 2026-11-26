import type { FlagsDiffResponse } from "@shepherdjerred/feature-flags/flags-wire.ts";

export type DeploymentDrift = FlagsDiffResponse["deployments"][number];

export type DriftCategory = "invalid" | "drift" | "missing" | "extra";

/** Worst first: an invalid live value breaks consumers, drift changes behaviour. */
export const DRIFT_CATEGORIES: readonly DriftCategory[] = [
  "invalid",
  "drift",
  "missing",
  "extra",
];

export const DRIFT_SEVERITY = {
  invalid: "error",
  drift: "warning",
  missing: "info",
  extra: "info",
} as const satisfies Readonly<
  Record<DriftCategory, "error" | "warning" | "info">
>;

export const DRIFT_LABEL: Readonly<Record<DriftCategory, string>> = {
  invalid: "Invalid",
  drift: "Drift",
  missing: "Missing",
  extra: "Extra",
};

export const DRIFT_HINT: Readonly<Record<DriftCategory, string>> = {
  invalid: "Live value fails its schema",
  drift: "Live value differs from the inventory",
  missing: "Declared but not in Flags",
  extra: "In Flags but not declared",
};

export type DriftCounts = Readonly<Record<DriftCategory, number>>;

export function deploymentCounts(entry: DeploymentDrift): DriftCounts {
  return {
    invalid: entry.invalid.length,
    drift: entry.drift.length,
    missing: entry.missing.length,
    extra: entry.extra.length,
  };
}

export function totalCounts(
  deployments: readonly DeploymentDrift[],
): DriftCounts {
  const total = { invalid: 0, drift: 0, missing: 0, extra: 0 };
  for (const entry of deployments) {
    const counts = deploymentCounts(entry);
    for (const category of DRIFT_CATEGORIES)
      total[category] += counts[category];
  }
  return total;
}

export function itemCount(counts: DriftCounts): number {
  return counts.invalid + counts.drift + counts.missing + counts.extra;
}

/** The worst category present, as a severity; `ok` when nothing drifted. */
export function driftSeverity(
  counts: DriftCounts,
): "ok" | "info" | "warning" | "error" {
  const worst = DRIFT_CATEGORIES.find((category) => counts[category] > 0);
  return worst === undefined ? "ok" : DRIFT_SEVERITY[worst];
}

const SEVERITY_RANK = { error: 0, warning: 1, info: 2, ok: 3 } as const;

/** Deployments ordered by their worst category, then by id. */
export function worstFirst(
  deployments: readonly DeploymentDrift[],
): DeploymentDrift[] {
  const rank = (entry: DeploymentDrift): number =>
    SEVERITY_RANK[driftSeverity(deploymentCounts(entry))];
  return deployments.toSorted(
    (left, right) =>
      rank(left) - rank(right) || left.id.localeCompare(right.id),
  );
}

export function driftPath(id?: string): string {
  return id === undefined ? "/drift" : `/drift#${id}`;
}

export type Remedy = {
  readonly summary: string;
  readonly commands: readonly string[];
};

function flagArguments(keys: readonly string[]): string {
  return keys.map((key) => `--flag ${key}`).join(" ");
}

/**
 * How to fix one category in one deployment, from the "Operate feature flags
 * and check the inventory" how-to. `origin` is the Flags URL to target.
 */
export function remedy(
  category: DriftCategory,
  entry: DeploymentDrift,
  origin: string,
): Remedy {
  const url = `FLAGS_URL="${origin}"`;
  switch (category) {
    case "missing": {
      return {
        summary:
          "The flag-inventory-sync schedule creates missing keys within two minutes. To create them now without touching existing values:",
        commands: [
          `${url} toolkit run --env FLAGS_MACHINE_TOKEN -- bun run check-flag-inventory -- --deployment ${entry.id} --apply-missing`,
        ],
      };
    }
    case "drift": {
      const flags = flagArguments(entry.drift.map((item) => item.key));
      return {
        summary:
          "If the live value is intended, change managed-flag-inventory.json instead. Otherwise preview, then write the declared values:",
        commands: [
          `${url} bun run check-flag-inventory -- --plan-declared --deployment ${entry.id} ${flags} --json`,
          `${url} toolkit run --env FLAGS_MACHINE_TOKEN -- bun run check-flag-inventory -- --apply-declared --deployment ${entry.id} ${flags} --json`,
        ],
      };
    }
    case "invalid": {
      return {
        summary:
          "Fix the value in the editor, or read the current revision and apply a reviewed JSON batch:",
        commands: [
          ...entry.invalid.map(
            (item) => `toolkit flags get ${entry.id} ${item.key} --json`,
          ),
          "toolkit flags apply --file reviewed.json",
        ],
      };
    }
    case "extra": {
      return {
        summary:
          "Declare the key in managed-flag-inventory.json, or list the exact tuple in retired-flag-declarations.ts so scheduled reconciliation retires it.",
        commands: [],
      };
    }
  }
}
