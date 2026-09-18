import { z } from "zod";
import { log } from "../logger.ts";
import { parseCsvRow } from "../csv/rows.ts";
import type { VenmoTransaction } from "./types.ts";

const VenmoTransactionSchema = z.object({
  id: z.string(),
  datetime: z.string(),
  type: z.string(),
  status: z.string(),
  note: z.string(),
  from: z.string(),
  to: z.string(),
  amount: z.number(),
  tip: z.number(),
  tax: z.number(),
  fee: z.number(),
});

function parseAmount(raw: string): number {
  const cleaned = raw
    .replaceAll("$", "")
    .replaceAll(",", "")
    .replaceAll(" ", "");
  if (cleaned === "" || cleaned === "+" || cleaned === "-") return 0;
  const value = Number.parseFloat(cleaned);
  return Number.isNaN(value) ? 0 : value;
}

// Reads one Venmo statement export.
//
// This used to cache its result to a single file keyed on nothing and with no
// expiry, so the first export ever parsed was returned for every later one —
// dropping a new export into the vault changed nothing until the cache was
// deleted by hand. Reading a local CSV costs milliseconds; the cache bought
// nothing and silently discarded new data.
export async function parseVenmoCSV(
  csvPath: string,
): Promise<VenmoTransaction[]> {
  const text = await Bun.file(csvPath).text();
  const lines = text.split("\n").filter((line) => line.trim().length > 0);

  // Row 0-1: metadata, Row 2: header, Row 3: balance summary, Row 4+: data
  const dataLines = lines.slice(4);

  const transactions: VenmoTransaction[] = [];

  for (const line of dataLines) {
    const fields = parseCsvRow(line);
    // Fields: [empty, ID, Datetime, Type, Status, Note, From, To, Amount, Tip, Tax, Fee, ...]
    const type = fields[3] ?? "";
    if (type !== "Payment") continue;

    const transaction = VenmoTransactionSchema.parse({
      id: fields[1] ?? "",
      datetime: fields[2] ?? "",
      type,
      status: fields[4] ?? "",
      note: fields[5] ?? "",
      from: fields[6] ?? "",
      to: fields[7] ?? "",
      amount: parseAmount(fields[8] ?? "0"),
      tip: parseAmount(fields[9] ?? "0"),
      tax: parseAmount(fields[10] ?? "0"),
      fee: parseAmount(fields[11] ?? "0"),
    });

    transactions.push(transaction);
  }

  log.info(`Parsed ${String(transactions.length)} Venmo payment transactions`);

  return transactions;
}
