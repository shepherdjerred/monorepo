import type { AmazonCharge } from "./types.ts";

export function parseAmazonDate(text: string): string {
  const cleaned = text.replaceAll(/\s+/g, " ").trim();
  const parsed = new Date(cleaned);
  return Number.isNaN(parsed.getTime())
    ? cleaned
    : (parsed.toISOString().split("T")[0] ?? cleaned);
}

export function parsePrice(text: string): number {
  const cleaned = text.replaceAll(/[^\d,.]/g, "");
  const match = /[\d,]+\.\d{2}/.exec(cleaned);
  return match?.[0] === undefined
    ? 0
    : Number.parseFloat(match[0].replaceAll(",", ""));
}

// Rows extracted in document order from the payments transaction-history
// page: date headers followed by the transactions that occurred on that date.
export type TransactionRow =
  | { kind: "date"; text: string }
  | {
      kind: "txn";
      amountText: string;
      paymentMethod: string;
      orderText: string;
    };

const LINK_STATUSES = new Set(["Charged", "Refunded", "Pending"]);

// The rebuilt payments page renders each transaction as a single link
// whose text lines are: "Mon DD, YYYY·Merchant", the payment method,
// "Order #...", the signed amount, and the status. Turn one link's text
// into the same row shape the classic markup produced so the fold below
// (and its charge/refund/gift-card rules) applies unchanged.
export function transactionRowsFromLinkText(text: string): TransactionRow[] {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
  const dateLine = lines.find((line) => line.includes("·"));
  const amountLine = lines.find((line) => /\$[\d,]+\.\d{2}/.test(line));
  const orderLine = lines.find((line) => line.includes("Order #"));
  if (
    dateLine === undefined ||
    amountLine === undefined ||
    orderLine === undefined
  ) {
    return [];
  }
  const paymentLine = lines.find(
    (line) =>
      line !== dateLine &&
      line !== amountLine &&
      line !== orderLine &&
      !LINK_STATUSES.has(line),
  );
  if (paymentLine === undefined) return [];
  return [
    { kind: "date", text: dateLine.split("·")[0] ?? "" },
    {
      kind: "txn",
      amountText: amountLine,
      paymentMethod: paymentLine,
      orderText: orderLine,
    },
  ];
}

export type FoldedTransactions = {
  byOrder: Map<string, AmazonCharge[]>;
  oldestDate: string | undefined;
  skippedGiftCard: number;
  skippedNoOrder: number;
};

const ORDER_ID_PATTERN = /(\d{3}-\d{7}-\d{7})/;

// The page prints money movement from the account's perspective: "-$49.30"
// is a payment and an unsigned amount is money back. AmazonCharge uses the
// opposite convention (positive = card charge, negative = refund).
export function foldTransactionRows(
  rows: TransactionRow[],
): FoldedTransactions {
  const byOrder = new Map<string, AmazonCharge[]>();
  let currentDate: string | undefined;
  let oldestDate: string | undefined;
  let skippedGiftCard = 0;
  let skippedNoOrder = 0;

  for (const row of rows) {
    if (row.kind === "date") {
      currentDate = parseAmazonDate(row.text);
      if (oldestDate === undefined || currentDate < oldestDate) {
        oldestDate = currentDate;
      }
      continue;
    }

    if (currentDate === undefined) continue;

    const outcome = chargeFromRow(row, currentDate);
    if (outcome === "no-order") {
      skippedNoOrder++;
      continue;
    }
    if (outcome === "gift-card") {
      skippedGiftCard++;
      continue;
    }
    if (outcome === undefined) continue;

    const charges = byOrder.get(outcome.orderId) ?? [];
    charges.push(outcome.charge);
    byOrder.set(outcome.orderId, charges);
  }

  return { byOrder, oldestDate, skippedGiftCard, skippedNoOrder };
}

function chargeFromRow(
  row: { amountText: string; paymentMethod: string; orderText: string },
  date: string,
):
  | { orderId: string; charge: AmazonCharge }
  | "no-order"
  | "gift-card"
  | undefined {
  const orderMatch = ORDER_ID_PATTERN.exec(row.orderText);
  if (orderMatch?.[1] === undefined) return "no-order";

  // Gift-card-funded movements never reach the bank account, so they must
  // not compete with card charges during matching.
  if (/gift card/i.test(row.paymentMethod)) return "gift-card";

  const magnitude = parsePrice(row.amountText);
  if (magnitude <= 0) return undefined;
  const isPayment = row.amountText.includes("-");

  return {
    orderId: orderMatch[1],
    charge: {
      date,
      amount: isPayment ? magnitude : -magnitude,
      description: row.paymentMethod.trim(),
    },
  };
}
