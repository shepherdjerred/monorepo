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

const loadoutNames = reportLoadoutNames();

function asNumericId(value: string | number): number | undefined {
  if (typeof value === "number") return value;
  return /^\d+$/u.test(value) ? Number(value) : undefined;
}

export function reportAssetInfo(
  kind: ReportAssetKind,
  value: string | number,
): ReportAssetInfo | undefined {
  if (kind === "champion") {
    const id = asNumericId(value);
    const text = String(value).toLocaleLowerCase("en-US");
    const champion = browserChampions.find(
      (candidate) =>
        (id !== undefined && candidate.id === id) ||
        candidate.key.toLocaleLowerCase("en-US") === text ||
        candidate.name.toLocaleLowerCase("en-US") === text,
    );
    return champion === undefined
      ? undefined
      : { canonicalKey: champion.key, name: champion.name };
  }

  const loadoutKind: LoadoutNameKind = kind;
  const id = asNumericId(value);
  if (kind === "item" && id === 0) {
    return { canonicalKey: null, name: "Empty" };
  }
  const text = String(value).toLocaleLowerCase("en-US");
  const entry = loadoutNames.find(
    (candidate) =>
      candidate.kind === loadoutKind &&
      ((id !== undefined && candidate.id === id) ||
        candidate.name.toLocaleLowerCase("en-US") === text ||
        String(candidate.assetKey).toLocaleLowerCase("en-US") === text),
  );
  return entry === undefined
    ? undefined
    : { canonicalKey: entry.assetKey, name: entry.name };
}
