import type { AppleReceipt, AppleReceiptItem } from "./types.ts";
import { loadEmailIndex } from "../mail/index.ts";
import { extractTextBody } from "../mail/parse.ts";
import { log } from "../logger.ts";

const MONTHS: Record<string, string> = {
  jan: "01",
  feb: "02",
  mar: "03",
  apr: "04",
  may: "05",
  jun: "06",
  jul: "07",
  aug: "08",
  sep: "09",
  oct: "10",
  nov: "11",
  dec: "12",
};

// Returns "" when the text carries no recognizable date so callers fail
// closed instead of letting NaN date math pass a window check.
//
// Months arrive both abbreviated ("Sep 10, 2024") and spelled out
// ("August 30, 2026"), so the first three letters do the lookup.
export function parseAppleDate(text: string): string {
  const match = /([a-z]{3,9})\.?\s+(\d{1,2}),\s+(\d{4})/i.exec(text);
  if (!match) return "";
  const month = MONTHS[(match[1] ?? "").slice(0, 3).toLowerCase()];
  if (month === undefined) return "";
  const day = (match[2] ?? "").padStart(2, "0");
  const year = match[3] ?? "";
  return `${year}-${month}-${day}`;
}

// Apple has emailed three receipt layouts, and each field has to be read
// through a list of fallbacks rather than one pattern:
//
//  - the original plain text labels every field with a colon
//    ("ORDER ID:", "DATE:", "TOTAL:"), one item per line;
//  - a later HTML layout drops the colons ("DATE Aug 11, 2026") and strips to
//    a single flat line, which is why a pattern requiring the colon rejected
//    the receipt outright;
//  - the current subscription-renewal layout has no TOTAL row at all. It
//    prints the date as "Receipt August 30, 2026" and leaves the charged
//    amount to be read as subtotal plus tax.
//
// `\bTOTAL` cannot match inside "Subtotal" — there is no word boundary
// between "b" and "t" — so the labelled total stays unambiguous.
const ORDER_ID = /ORDER\s+ID:?\s*([A-Z0-9]{6,})/i;
const LABELLED_DATE = /\bDATE:?\s+([a-z]{3,9}\.?\s+\d{1,2},\s+\d{4})/i;
const RECEIPT_DATE = /\bReceipt\s+([a-z]{3,9}\s+\d{1,2},\s+\d{4})/i;
const LABELLED_TOTAL = /\bTOTAL:?\s*\$?([\d,]+\.\d{2})/i;
const SUBTOTAL = /\bSubtotal:?\s*\$?([\d,]+\.\d{2})/i;
const TAX = /\bTax:?\s*\$?([\d,]+\.\d{2})/i;

function money(raw: string | undefined): number {
  const value = Number.parseFloat((raw ?? "0").replaceAll(",", ""));
  return Number.isFinite(value) ? value : 0;
}

function parseReceiptDate(body: string): string {
  const labelled = LABELLED_DATE.exec(body);
  if (labelled) return parseAppleDate(labelled[1] ?? "");
  const printed = RECEIPT_DATE.exec(body);
  return printed ? parseAppleDate(printed[1] ?? "") : "";
}

// What the card was actually charged, which is what the matcher compares
// against the transaction.
function parseReceiptTotal(body: string): number {
  const labelled = LABELLED_TOTAL.exec(body);
  if (labelled) return money(labelled[1]);
  const subtotal = SUBTOTAL.exec(body);
  if (!subtotal) return 0;
  const tax = TAX.exec(body);
  return money(subtotal[1]) + (tax === null ? 0 : money(tax[1]));
}

export function parseAppleReceipt(body: string): AppleReceipt | null {
  const orderMatch = ORDER_ID.exec(body);
  if (!orderMatch) return null;

  const lineItems = parseAppleItems(body);

  return {
    orderId: orderMatch[1] ?? "",
    date: parseReceiptDate(body),
    total: parseReceiptTotal(body),
    // The flat layouts put the whole receipt on one line, so there are no
    // per-item lines to read.
    items: lineItems.length > 0 ? lineItems : parseFlatItems(body),
  };
}

// Where the purchased items stop and the payment summary begins. Some
// layouts print no subtotal and go straight from the item to the total.
const ITEM_REGION_END = /\bSubtotal\b|\bBilling and Payment\b|\bTOTAL\b/i;
// The last header field before the items start.
const ITEM_REGION_START = /DOCUMENT\s+NO\.?:?\s*\d+|APPLE\s+ACCOUNT:?\s*\S+/gi;
const PRICE = /\$(\d+(?:,\d{3})*\.\d{2})/g;
// A separate non-global copy: `exec` on a global regex advances its lastIndex,
// and matchAll would then inherit the advanced position.
const FIRST_PRICE = /\$\d+(?:,\d{3})*\.\d{2}/;
// A title runs until the first of these: everything after is receipt
// furniture, not the name of what was bought. "… App Jerred's MacBook Pro"
// names the device the purchase was made on, which is not part of the item.
// "App Store" is the section label, not that marker, so it is excluded.
const TITLE_END =
  /\s+(?:Renews\b|In-App Purchase\b|Report a Problem\b|(?:iOS\s+)?App\s+(?!Store\b)\S)/i;
const SECTION_LABEL = /^(?:App|Mac App|iTunes|Apple|Book)\s*Store\s+/i;
const SUBSCRIPTION = /\bRenews\b|\((?:Monthly|Yearly|Annual)\)/i;

// Items from a receipt that stripped to a single line.
function parseFlatItems(body: string): AppleReceiptItem[] {
  const end = ITEM_REGION_END.exec(body);
  const head = body.slice(0, end?.index ?? body.length);

  // The items begin at the last header field that still precedes the first
  // price. "Apple Account" also appears among the footer links, so a marker
  // found after the prices is footer text rather than a header.
  const firstPrice = FIRST_PRICE.exec(head)?.index ?? head.length;
  let start = 0;
  for (const marker of head.matchAll(ITEM_REGION_START)) {
    const markerEnd = marker.index + marker[0].length;
    if (markerEnd <= firstPrice) start = markerEnd;
  }
  const region = head.slice(start);

  const items: AppleReceiptItem[] = [];
  let cursor = 0;
  for (const match of region.matchAll(PRICE)) {
    const segment = region.slice(cursor, match.index);
    cursor = match.index + match[0].length;

    const price = money(match[1]);
    const title = (segment.split(TITLE_END)[0] ?? "")
      .replaceAll(/\s+/g, " ")
      .trim()
      .replace(SECTION_LABEL, "")
      .trim();
    if (title === "" || price === 0) continue;
    if (SKIP_TITLES.has(title.toLowerCase())) continue;

    items.push({ title, price, isSubscription: SUBSCRIPTION.test(segment) });
  }
  return items;
}

const SKIP_TITLES = new Set(["tax", "subtotal", "total", "total:"]);
const SUBSCRIPTION_LINE = /\b(?:subscription|renews|monthly|yearly|annual)\b/i;

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

    // The billing period and the renewal date are printed on separate lines
    // under the item, so one line of lookahead is not enough.
    const following = `${lines[i + 1] ?? ""} ${lines[i + 2] ?? ""}`;
    const isSubscription = SUBSCRIPTION_LINE.test(following);

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
