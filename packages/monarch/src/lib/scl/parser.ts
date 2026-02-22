import type { SclBill } from "./types.ts";
import { log } from "../logger.ts";

function parseDate(dateStr: string): string {
  const parts = dateStr.split("/");
  const month = parts[0] ?? "01";
  const day = parts[1] ?? "01";
  const year = parts[2] ?? "2025";
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

function parseAmount(raw: string): number {
  const cleaned = raw.replaceAll("$", "").replaceAll(",", "").trim();
  return Number.parseFloat(cleaned);
}

export function parseSclCSV(text: string): SclBill[] {
  const lines = text.split("\n").filter((line) => line.trim().length > 0);

  // Skip header rows: "Download Date,..." and "Account Number,..."
  const dataLines = lines.slice(2);
  const bills: SclBill[] = [];

  for (const line of dataLines) {
    // CSV with quoted fields
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

    const accountNumber = fields[0] ?? "";
    const billDateRaw = fields[2] ?? "";
    const billAmountRaw = fields[3] ?? "";
    const dueDateRaw = fields[4] ?? "";

    if (billDateRaw === "" || billAmountRaw === "") continue;

    const billAmount = parseAmount(billAmountRaw);
    if (billAmount <= 0) continue;

    bills.push({
      accountNumber,
      billDate: parseDate(billDateRaw),
      billAmount,
      dueDate: parseDate(dueDateRaw),
    });
  }

  log.info(`Parsed ${String(bills.length)} Seattle City Light bills`);
  return bills;
}
