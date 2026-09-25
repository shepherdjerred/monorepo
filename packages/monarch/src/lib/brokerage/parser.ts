import { parseCsvRows } from "../csv/rows.ts";
import type { CashEvent, ShareSale } from "./types.ts";

// Schwab's brokerage exports, which come as two separate files.
//
// `Individual_..._Transactions.csv` is a flat ledger: one header row, then
// MoneyLink Transfers, Sells, Stock Plan Activity and Credit Interest under
// the same columns. It says what moved and when, but never what a sale cost.
//
// `..._GainLoss_Realized.csv` carries the basis. It opens with a title line
// before its header and closes with a Total row, neither of which is data.

const TRANSFER_ACTION = "MoneyLink Transfer";
const INTEREST_ACTION = "Credit Interest";
const TOTAL_ROW = "Total";

function parseUsDate(raw: string): string | undefined {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(raw.trim());
  return match === null
    ? undefined
    : `${match[3] ?? ""}-${match[1] ?? ""}-${match[2] ?? ""}`;
}

// Schwab writes money as "-$25943.70", "$1,372" or "--" for absent.
function parseMoney(raw: string): number | undefined {
  const cleaned = raw.replaceAll("$", "").replaceAll(",", "").trim();
  if (cleaned === "" || cleaned === "--") return undefined;
  const value = Number.parseFloat(cleaned);
  return Number.isFinite(value) ? value : undefined;
}

export function parseBrokerageTransactionsCsv(text: string): CashEvent[] {
  const events: CashEvent[] = [];
  for (const fields of parseCsvRows(text)) {
    const date = parseUsDate(fields[0] ?? "");
    if (date === undefined) continue;

    const action = (fields[1] ?? "").trim();
    const kind =
      action === TRANSFER_ACTION
        ? "transfer"
        : action === INTEREST_ACTION
          ? "interest"
          : undefined;
    if (kind === undefined) continue;

    const amount = parseMoney(fields[7] ?? "");
    if (amount === undefined) continue;

    // A transfer out is negative in the broker's ledger and positive in the
    // bank's. Both describe the same money, so it is stored as a magnitude
    // and the sign is left to whichever side is being matched.
    events.push({
      kind,
      date,
      amount: Math.abs(amount),
      description: (fields[3] ?? "").trim(),
    });
  }
  return events.sort((a, b) => a.date.localeCompare(b.date));
}

export function parseRealizedGainLossCsv(text: string): ShareSale[] {
  const sales: ShareSale[] = [];
  for (const fields of parseCsvRows(text)) {
    // The Total row repeats the columns with an empty date, and the title
    // line has no date either; both fall out here.
    if ((fields[0] ?? "").trim() === TOTAL_ROW) continue;
    const soldDate = parseUsDate(fields[2] ?? "");
    if (soldDate === undefined) continue;

    const quantity = parseMoney(fields[3] ?? "");
    const price = parseMoney(fields[4] ?? "");
    const proceeds = parseMoney(fields[6] ?? "");
    const costBasis = parseMoney(fields[7] ?? "");
    const gainLoss = parseMoney(fields[8] ?? "");
    if (
      quantity === undefined ||
      price === undefined ||
      proceeds === undefined ||
      costBasis === undefined ||
      gainLoss === undefined
    ) {
      continue;
    }

    sales.push({
      symbol: (fields[0] ?? "").trim(),
      soldDate,
      quantity,
      price,
      proceeds,
      costBasis,
      gainLoss,
    });
  }
  return sales.sort((a, b) => a.soldDate.localeCompare(b.soldDate));
}
