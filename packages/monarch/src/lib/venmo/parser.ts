import { z } from "zod";
import path from "node:path";
import { homedir } from "node:os";
import { log } from "../logger.ts";
import type { VenmoTransaction } from "./types.ts";

const CACHE_DIR = path.join(homedir(), ".monarch-cache");
const CACHE_FILE = path.join(CACHE_DIR, "venmo.json");

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

function parseCSVRow(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (const char of line) {
    if (inQuotes) {
      if (char === '"') {
        inQuotes = false;
      } else {
        current += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      fields.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }

  fields.push(current.trim());
  return fields;
}

function parseAmount(raw: string): number {
  const cleaned = raw.replaceAll("$", "").replaceAll(",", "").replaceAll(" ", "");
  if (cleaned === "" || cleaned === "+" || cleaned === "-") return 0;
  const value = Number.parseFloat(cleaned);
  return Number.isNaN(value) ? 0 : value;
}

export async function parseVenmoCSV(
  csvPath: string,
): Promise<VenmoTransaction[]> {
  const cached = Bun.file(CACHE_FILE);
  if (await cached.exists()) {
    log.info("Using cached Venmo data");
    const data: unknown = await cached.json();
    return z.array(VenmoTransactionSchema).parse(data);
  }

  const text = await Bun.file(csvPath).text();
  const lines = text.split("\n").filter((line) => line.trim().length > 0);

  // Row 0-1: metadata, Row 2: header, Row 3: balance summary, Row 4+: data
  const dataLines = lines.slice(4);

  const transactions: VenmoTransaction[] = [];

  for (const line of dataLines) {
    const fields = parseCSVRow(line);
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

  await Bun.write(CACHE_FILE, JSON.stringify(transactions, undefined, 2));
  return transactions;
}
