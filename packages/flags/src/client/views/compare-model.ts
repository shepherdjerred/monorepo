import type { FlagValue } from "@shepherdjerred/feature-flags/evaluate.ts";
import {
  sameFlag,
  splitDeploymentId,
} from "@shepherdjerred/flags/client/model.ts";

export type CompareStatus = "only-left" | "only-right" | "differs" | "same";

export type CompareRow = {
  readonly key: string;
  readonly status: CompareStatus;
  readonly left?: FlagValue;
  readonly right?: FlagValue;
};

export type CompareCounts = Readonly<Record<CompareStatus, number>>;

/**
 * Every key in either deployment, sorted, with how the two sides compare.
 * Flags are equal when `sameFlag` says so: type, key, default, and the
 * ordered segments, or the variant string.
 */
export function diffDocuments(
  left: { readonly flags: readonly FlagValue[] },
  right: { readonly flags: readonly FlagValue[] },
): CompareRow[] {
  const leftByKey = new Map(left.flags.map((flag) => [flag.key, flag]));
  const rightByKey = new Map(right.flags.map((flag) => [flag.key, flag]));
  const keys = [...new Set([...leftByKey.keys(), ...rightByKey.keys()])].sort();
  return keys.map((key): CompareRow => {
    const leftFlag = leftByKey.get(key);
    const rightFlag = rightByKey.get(key);
    if (rightFlag === undefined && leftFlag !== undefined)
      return { key, status: "only-left", left: leftFlag };
    if (leftFlag === undefined && rightFlag !== undefined)
      return { key, status: "only-right", right: rightFlag };
    if (leftFlag === undefined || rightFlag === undefined)
      throw new Error(`compare key ${key} is in neither deployment`);
    return {
      key,
      status: sameFlag(leftFlag, rightFlag) ? "same" : "differs",
      left: leftFlag,
      right: rightFlag,
    };
  });
}

export function countRows(rows: readonly CompareRow[]): CompareCounts {
  const counts = { "only-left": 0, "only-right": 0, differs: 0, same: 0 };
  for (const row of rows) counts[row.status] += 1;
  return counts;
}

/**
 * The rows the table lists: identical flags only when `showSame` is set, and
 * only keys containing `query` (ignoring case and surrounding spaces).
 */
export function visibleRows(
  rows: readonly CompareRow[],
  { showSame, query }: { readonly showSame: boolean; readonly query: string },
): CompareRow[] {
  const needle = query.trim().toLowerCase();
  return rows.filter(
    (row) =>
      (showSame || row.status !== "same") &&
      (needle.length === 0 || row.key.toLowerCase().includes(needle)),
  );
}

/** The other stage of a catalog that has both beta and prod, if any. */
export function pairedStage(
  ids: readonly string[],
  id: string,
): string | undefined {
  const { catalog, stage } = splitDeploymentId(id);
  const other =
    stage === "beta" ? "prod" : stage === "prod" ? "beta" : undefined;
  if (other === undefined) return undefined;
  const candidate = `${catalog}/${other}`;
  return ids.includes(candidate) ? candidate : undefined;
}

/**
 * The two deployments a compare page shows. Known URL choices win. With only
 * `left`, its catalog's other stage is the default partner; with neither, the
 * first catalog that has beta and prod, else the first two deployments.
 */
export function comparePair(
  ids: readonly string[],
  requested: { readonly left?: string | null; readonly right?: string | null },
): { readonly left: string; readonly right: string } | undefined {
  const known = (id: string | null | undefined): string | undefined =>
    id !== null && id !== undefined && ids.includes(id) ? id : undefined;
  const sorted = [...ids].sort();
  const firstOther = (id: string): string | undefined =>
    sorted.find((candidate) => candidate !== id);
  const left = known(requested.left);
  const right = known(requested.right);
  if (left !== undefined && right !== undefined) return { left, right };
  if (left !== undefined) {
    const partner = pairedStage(ids, left) ?? firstOther(left);
    return partner === undefined ? undefined : { left, right: partner };
  }
  if (right !== undefined) {
    const partner = pairedStage(ids, right) ?? firstOther(right);
    return partner === undefined ? undefined : { left: partner, right };
  }
  const beta = sorted.find(
    (id) =>
      splitDeploymentId(id).stage === "beta" &&
      pairedStage(ids, id) !== undefined,
  );
  if (beta !== undefined) {
    const prod = pairedStage(ids, beta);
    if (prod !== undefined) return { left: beta, right: prod };
  }
  const [first, second] = sorted;
  return first === undefined || second === undefined
    ? undefined
    : { left: first, right: second };
}

export function comparePath(
  left: string,
  right: string,
  extra?: { readonly key?: string },
): string {
  const params = new URLSearchParams({ left, right });
  if (extra?.key !== undefined) params.set("key", extra.key);
  return `/compare?${params.toString()}`;
}

export const COMPARE_STATUS_SEVERITY = {
  differs: "warning",
  "only-left": "info",
  "only-right": "info",
  same: "ok",
} as const satisfies Readonly<Record<CompareStatus, "ok" | "info" | "warning">>;

export function statusLabel(
  status: CompareStatus,
  left: string,
  right: string,
): string {
  switch (status) {
    case "differs": {
      return "Differs";
    }
    case "same": {
      return "Same";
    }
    case "only-left": {
      return `Only in ${left}`;
    }
    case "only-right": {
      return `Only in ${right}`;
    }
  }
}
