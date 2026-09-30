import { browserChampions } from "#src/browser-assets.ts";
import type { ReportAssetKind } from "#src/model/reports/report.ts";
import {
  reportLoadoutNames,
  type LoadoutNameKind,
} from "#src/model/reports/report-query-loadout.ts";

export type ReportAssetInfo = {
  canonicalKey: string | number | null;
  name: string;
};

export class ReportAssetResolutionError extends Error {
  constructor(
    readonly kind: ReportAssetKind,
    readonly value: string | number,
    readonly reason: "not-found" | "ambiguous",
  ) {
    super(
      reason === "ambiguous"
        ? `Ambiguous ${kind} name ${JSON.stringify(value)}`
        : `Unknown ${kind} asset ${JSON.stringify(value)}`,
    );
    this.name = "ReportAssetResolutionError";
  }
}

const loadoutNames = reportLoadoutNames();

function asNumericId(value: string | number): number | undefined {
  if (typeof value === "number") return value;
  return /^\d+$/u.test(value) ? Number(value) : undefined;
}

export function reportAssetInfo(
  kind: ReportAssetKind,
  value: string | number,
): ReportAssetInfo {
  const resolve = <T extends { name: string }>(
    entries: T[],
    toInfo: (entry: T) => ReportAssetInfo,
  ): ReportAssetInfo => {
    if (entries.length === 0) {
      throw new ReportAssetResolutionError(kind, value, "not-found");
    }
    if (entries.length > 1) {
      throw new ReportAssetResolutionError(kind, value, "ambiguous");
    }
    const [entry] = entries;
    if (entry === undefined) {
      throw new ReportAssetResolutionError(kind, value, "not-found");
    }
    return toInfo(entry);
  };

  if (kind === "champion" && (value === -1 || value === "-1")) {
    return { canonicalKey: null, name: "No ban" };
  }

  if (kind === "champion") {
    const id = asNumericId(value);
    const text = String(value).toLocaleLowerCase("en-US");
    if (id !== undefined) {
      return resolve(
        browserChampions.filter((candidate) => candidate.id === id),
        (champion) => ({ canonicalKey: champion.key, name: champion.name }),
      );
    }
    const byKey = browserChampions.filter(
      (candidate) => candidate.key.toLocaleLowerCase("en-US") === text,
    );
    if (byKey.length > 0) {
      return resolve(byKey, (champion) => ({
        canonicalKey: champion.key,
        name: champion.name,
      }));
    }
    return resolve(
      browserChampions.filter(
        (candidate) => candidate.name.toLocaleLowerCase("en-US") === text,
      ),
      (champion) => ({ canonicalKey: champion.key, name: champion.name }),
    );
  }

  const loadoutKind: LoadoutNameKind = kind;
  const id = asNumericId(value);
  if (kind === "item" && id === 0) {
    return { canonicalKey: null, name: "Empty" };
  }
  if (id !== undefined) {
    return resolve(
      loadoutNames.filter(
        (candidate) => candidate.kind === loadoutKind && candidate.id === id,
      ),
      (entry) => ({ canonicalKey: entry.assetKey, name: entry.name }),
    );
  }
  const text = String(value).toLocaleLowerCase("en-US");
  const byKey = loadoutNames.filter(
    (candidate) =>
      candidate.kind === loadoutKind &&
      String(candidate.assetKey).toLocaleLowerCase("en-US") === text,
  );
  if (byKey.length > 0) {
    return resolve(byKey, (entry) => ({
      canonicalKey: entry.assetKey,
      name: entry.name,
    }));
  }
  return resolve(
    loadoutNames.filter(
      (candidate) =>
        candidate.kind === loadoutKind &&
        candidate.name.toLocaleLowerCase("en-US") === text,
    ),
    (entry) => ({ canonicalKey: entry.assetKey, name: entry.name }),
  );
}
