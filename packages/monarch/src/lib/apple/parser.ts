import { Glob } from "bun";
import path from "node:path";
import type { AppleReceipt, AppleReceiptItem } from "./types.ts";
import { log } from "../logger.ts";

const MONTHS: Record<string, string> = {
  Jan: "01", Feb: "02", Mar: "03", Apr: "04",
  May: "05", Jun: "06", Jul: "07", Aug: "08",
  Sep: "09", Oct: "10", Nov: "11", Dec: "12",
};

export function parseAppleDate(text: string): string {
  const match = /(\w{3})\s+(\d{1,2}),\s+(\d{4})/.exec(text);
  if (!match) return text;
  const month = MONTHS[match[1] ?? ""];
  if (month === undefined) return text;
  const day = (match[2] ?? "").padStart(2, "0");
  const year = match[3] ?? "";
  return `${year}-${month}-${day}`;
}

function extractPlainTextBody(emlContent: string): string {
  const boundaryMatch = /boundary="([^"]+)"/.exec(emlContent);
  if (!boundaryMatch) {
    const headerEnd = emlContent.indexOf("\n\n");
    return headerEnd === -1 ? emlContent : emlContent.slice(headerEnd + 2);
  }

  const boundary = boundaryMatch[1] ?? "";
  const parts = emlContent.split(`--${boundary}`);

  for (const part of parts) {
    if (/Content-Type:\s*text\/plain/i.test(part)) {
      const bodyStart = part.indexOf("\n\n");
      if (bodyStart !== -1) {
        return part.slice(bodyStart + 2);
      }
    }
  }

  const headerEnd = emlContent.indexOf("\n\n");
  return headerEnd === -1 ? emlContent : emlContent.slice(headerEnd + 2);
}

export function parseAppleReceipt(emlContent: string): AppleReceipt | null {
  const body = extractPlainTextBody(emlContent);

  const orderMatch = /ORDER\s+ID:\s*(\S+)/i.exec(body);
  if (!orderMatch) return null;

  const dateMatch = /DATE:\s*(.+)/i.exec(body);
  const totalMatch = /TOTAL:\s*\$?([\d,.]+)/i.exec(body);

  const orderId = orderMatch[1] ?? "";
  const date = dateMatch ? parseAppleDate(dateMatch[1]?.trim() ?? "") : "";
  const total = totalMatch ? Number.parseFloat((totalMatch[1] ?? "0").replaceAll(",", "")) : 0;

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
    const isSubscription = nextLine.includes("subscription") || nextLine.includes("renews");

    items.push({ title, price, isSubscription });
  }

  return items;
}

export async function findAppleEmails(mailDir: string): Promise<string[]> {
  const results: string[] = [];
  const glob = new Glob("**/*.eml");

  for await (const file of glob.scan(mailDir)) {
    const filePath = path.join(mailDir, file);
    const content = await Bun.file(filePath).text();

    if (/Subject:.*Your receipt from Apple/i.test(content)) {
      results.push(filePath);
    }
  }

  log.info(`Found ${String(results.length)} Apple receipt emails`);
  return results;
}

export async function loadAppleReceipts(mailDir: string): Promise<AppleReceipt[]> {
  const emailPaths = await findAppleEmails(mailDir);
  const receipts: AppleReceipt[] = [];

  for (const emailPath of emailPaths) {
    const content = await Bun.file(emailPath).text();
    const receipt = parseAppleReceipt(content);
    if (receipt) {
      receipts.push(receipt);
    }
  }

  log.info(`Parsed ${String(receipts.length)} Apple receipts`);
  return receipts;
}
