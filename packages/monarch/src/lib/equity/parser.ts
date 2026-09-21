import { parseCsvRows } from "../csv/rows.ts";
import type { VestAward, VestEvent } from "./types.ts";

// Schwab's Equity Award Center transaction export.
//
// The file is two interleaved row shapes under one header: a parent row
// ("06/20/2026","Lapse","PINS","Restricted Stock Lapse","711",…) followed by a
// detail row whose leading columns are blank and whose award columns carry the
// grant. A detail row is therefore only meaningful in the context of the
// parent above it, which is why this is a stateful scan rather than a map.

const HEADER_FIRST_FIELD = "Date";
const LAPSE_ACTION = "Lapse";

type ParentRow = { vestDate: string; symbol: string; quantity: number };

function parseUsDate(raw: string): string | undefined {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(raw.trim());
  return match === null
    ? undefined
    : `${match[3] ?? ""}-${match[1] ?? ""}-${match[2] ?? ""}`;
}

function parseNumber(raw: string): number | undefined {
  const cleaned = raw.replaceAll("$", "").replaceAll(",", "").trim();
  if (cleaned === "") return undefined;
  const value = Number.parseFloat(cleaned);
  return Number.isFinite(value) ? value : undefined;
}

function parentFromRow(fields: string[]): ParentRow | undefined {
  const vestDate = parseUsDate(fields[0] ?? "");
  if (vestDate === undefined) return undefined;
  // Sales, dispositions and dividends also live in this export; only a lapse
  // is a vest, and only a vest has a corresponding zero-amount Monarch row.
  if ((fields[1] ?? "") !== LAPSE_ACTION) return undefined;
  const quantity = parseNumber(fields[4] ?? "");
  return quantity === undefined
    ? undefined
    : { vestDate, symbol: fields[2] ?? "", quantity };
}

function awardFromRow(
  fields: string[],
  parent: ParentRow,
): VestAward | undefined {
  const awardDate = parseUsDate(fields[8] ?? "");
  const fairMarketValue = parseNumber(fields[10] ?? "");
  if (awardDate === undefined || fairMarketValue === undefined)
    return undefined;
  return {
    awardDate,
    awardId: fields[9] ?? "",
    quantity: parent.quantity,
    fairMarketValue,
    sharesWithheldForTaxes: parseNumber(fields[12] ?? "") ?? 0,
    netSharesDeposited: parseNumber(fields[13] ?? "") ?? 0,
    taxes: parseNumber(fields[14] ?? "") ?? 0,
  };
}

export function parseEquityAwardsCsv(text: string): VestEvent[] {
  const byDate = new Map<string, VestEvent>();
  let parent: ParentRow | undefined;

  for (const fields of parseCsvRows(text)) {
    if ((fields[0] ?? "") === HEADER_FIRST_FIELD) continue;

    const nextParent = parentFromRow(fields);
    if (nextParent !== undefined) {
      parent = nextParent;
      continue;
    }
    if (parent === undefined) continue;

    const award = awardFromRow(fields, parent);
    if (award === undefined) continue;

    const event = byDate.get(parent.vestDate) ?? {
      vestDate: parent.vestDate,
      symbol: parent.symbol,
      awards: [],
    };
    event.awards.push(award);
    byDate.set(parent.vestDate, event);
    // A detail row is consumed by exactly one parent; leaving `parent` set
    // would let a malformed file attach two awards to one quantity.
    parent = undefined;
  }

  return [...byDate.values()].sort((a, b) =>
    a.vestDate.localeCompare(b.vestDate),
  );
}
