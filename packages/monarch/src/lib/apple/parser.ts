import type { AppleReceipt, AppleReceiptItem } from "./types.ts";
import { loadEmailIndex } from "../mail/index.ts";
import { extractTextBody } from "../mail/parse.ts";
import { log } from "../logger.ts";

const MONTHS: Record<string, string> = {
  Jan: "01",
  Feb: "02",
  Mar: "03",
  Apr: "04",
  May: "05",
  Jun: "06",
  Jul: "07",
  Aug: "08",
  Sep: "09",
  Oct: "10",
  Nov: "11",
  Dec: "12",
};

// Returns "" when the text carries no recognizable date so callers fail
// closed instead of letting NaN date math pass a window check.
export function parseAppleDate(text: string): string {
  const match = /(\w{3})\s+(\d{1,2}),\s+(\d{4})/.exec(text);
  if (!match) return "";
  const month = MONTHS[match[1] ?? ""];
  if (month === undefined) return "";
  const day = (match[2] ?? "").padStart(2, "0");
  const year = match[3] ?? "";
  return `${year}-${month}-${day}`;
}

// Parses an already-decoded plain-text receipt body.
export function parseAppleReceipt(body: string): AppleReceipt | null {
  const orderMatch = /ORDER\s+ID:\s*(\S+)/i.exec(body);
  if (!orderMatch) return null;

  const dateMatch = /DATE:\s*(.+)/i.exec(body);
  const totalMatch = /TOTAL:\s*\$?([\d,.]+)/i.exec(body);

  const orderId = orderMatch[1] ?? "";
  const date = dateMatch ? parseAppleDate(dateMatch[1]?.trim() ?? "") : "";
  const total = totalMatch
    ? Number.parseFloat((totalMatch[1] ?? "0").replaceAll(",", ""))
    : 0;

  const items = parseAppleItems(body);

  return { orderId, date, total, items };
}

const SKIP_TITLES = new Set(["tax", "subtotal", "total", "total:"]);

function parseAppleItems(body: string): AppleReceiptItem[] {
  const items: AppleReceiptItem[] = [];
  const lines = body.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const priceMatch = /^(.+\S)\s+\$(\d+\.\d{2})\s*$/.exec(line.trim());
    if (!priceMatch) continue;

    const title = (priceMatch[1] ?? "").trim();
    const price = Number.parseFloat(priceMatch[2] ?? "0");

    if (title === "" || price === 0) continue;
    if (SKIP_TITLES.has(title.toLowerCase())) continue;

    const nextLine = (lines[i + 1] ?? "").trim().toLowerCase();
    const isSubscription =
      nextLine.includes("subscription") || nextLine.includes("renews");

    items.push({ title, price, isSubscription });
  }

  return items;
}

const APPLE_RECEIPT_SUBJECT = /your receipt from apple/i;

// Loads Apple receipts from the shared MailMate index — every account and
// mailbox, with decoded (quoted-printable etc.) bodies.
export async function loadAppleReceipts(): Promise<AppleReceipt[]> {
  const index = await loadEmailIndex();
  const receiptEmails = index.filter((e) =>
    APPLE_RECEIPT_SUBJECT.test(e.subject),
  );
  log.info(`Found ${String(receiptEmails.length)} Apple receipt emails`);

  const receipts: AppleReceipt[] = [];
  for (const entry of receiptEmails) {
    const raw = await Bun.file(entry.path).text();
    const receipt = parseAppleReceipt(extractTextBody(raw));
    if (receipt) {
      receipts.push(receipt);
    }
  }

  log.info(`Parsed ${String(receipts.length)} Apple receipts`);
  return receipts;
}
