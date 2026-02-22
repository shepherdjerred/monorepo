import type { MonarchCategory } from "../monarch/types.ts";
import type { MonarchTransaction } from "../monarch/types.ts";
import type { WeekWindow, WeekGroup } from "../monarch/weeks.ts";
import type { ResolvedTransaction } from "../enrichment.ts";
import type { VenmoMatch } from "../venmo/matcher.ts";

let userHints = "";

export function setUserHints(hints: string): void {
  userHints = hints;
}

export function buildSystemPrompt(): string {
  const base = `You are a personal finance categorization expert. Your job is to classify financial transactions into the correct categories based on the merchant name, bank description, temporal context, and any additional context provided.

Rules:
- Always respond with valid JSON (no markdown fences, no extra text)
- Use only category IDs from the provided list
- Only classify transactions marked [CLASSIFY] — do NOT re-classify [RESOLVED] or [CONTEXT] transactions
- Use temporal context: transactions on the same day or nearby days can inform each other (e.g., a Venmo payment near a restaurant charge is likely for that meal)
- If you are unsure or cannot confidently determine the category, use the "Uncategorized" category
- Do NOT guess a category when you have low confidence — use Uncategorized instead`;

  if (userHints === "") return base;
  return `${base}

User-provided context (override your defaults with these):
${userHints}`;
}

export function buildCategoryList(categories: MonarchCategory[]): string {
  return categories
    .map((c) => `  - ${c.id}: ${c.name} (${c.group.name})`)
    .join("\n");
}

function formatWeekTransaction(
  txn: MonarchTransaction,
  resolvedMap: Map<string, ResolvedTransaction>,
  previousResults: Map<string, string>,
  isCurrentWeek: boolean,
): string {
  const sign = txn.amount < 0 ? "-" : "+";
  const amount = `${sign}$${Math.abs(txn.amount).toFixed(2)}`;
  const merchant = txn.merchant.name;
  const bankDesc = txn.plaidName === "" ? "" : ` | bank: "${txn.plaidName}"`;
  const acct = ` | acct: ${txn.account.displayName}`;

  const resolved = resolvedMap.get(txn.id);
  if (resolved) {
    if (resolved.detail !== undefined) {
      return `  [RESOLVED → SPLIT] ${txn.date} | ${amount} | ${merchant} | ${resolved.detail}`;
    }
    return `  [RESOLVED → ${resolved.category}] ${txn.date} | ${amount} | ${merchant}${bankDesc}`;
  }

  if (isCurrentWeek) {
    const current = ` | current: ${txn.category.name}`;
    return `  [CLASSIFY] ${txn.date} | ${amount} | ${merchant}${bankDesc}${acct}${current}`;
  }

  // Context week — show category (from previous results if available, otherwise Monarch's)
  const category = previousResults.get(txn.id) ?? txn.category.name;
  return `  ${txn.date} | ${amount} | ${merchant}${bankDesc} | ${category}`;
}

type WeekSectionOptions = {
  week: WeekGroup;
  label: string;
  resolvedMap: Map<string, ResolvedTransaction>;
  previousResults: Map<string, string>;
  isCurrentWeek: boolean;
};

function formatWeekSection(opts: WeekSectionOptions): string {
  const { week, label, resolvedMap, previousResults, isCurrentWeek } = opts;
  const suffix = isCurrentWeek ? "" : " [CONTEXT]";
  const header = `--- ${label} (${week.startDate} to ${week.endDate})${suffix} ---`;
  const lines = week.transactions.map((txn) =>
    formatWeekTransaction(txn, resolvedMap, previousResults, isCurrentWeek),
  );
  return `${header}\n${lines.join("\n")}`;
}

export function buildWeekPrompt(
  categories: MonarchCategory[],
  window: WeekWindow,
  resolvedMap: Map<string, ResolvedTransaction>,
  previousResults: Map<string, string>,
): string {
  const categoryList = buildCategoryList(categories);
  const sections: string[] = [];

  if (window.previous) {
    sections.push(
      formatWeekSection({
        week: window.previous,
        label: "PREVIOUS WEEK",
        resolvedMap,
        previousResults,
        isCurrentWeek: false,
      }),
    );
  }

  sections.push(
    formatWeekSection({
      week: window.current,
      label: "THIS WEEK",
      resolvedMap,
      previousResults,
      isCurrentWeek: true,
    }),
  );

  if (window.next) {
    sections.push(
      formatWeekSection({
        week: window.next,
        label: "NEXT WEEK",
        resolvedMap,
        previousResults,
        isCurrentWeek: false,
      }),
    );
  }

  return `Classify transactions marked [CLASSIFY]. Do NOT re-classify [RESOLVED] or [CONTEXT] transactions.

Available categories:
${categoryList}

${sections.join("\n\n")}

Respond with JSON:
{ "transactions": [{ "transactionId": "...", "categoryId": "...", "categoryName": "...", "confidence": "high"|"medium"|"low" }] }`;
}

export function buildAmazonBatchPrompt(
  categories: MonarchCategory[],
  orders: { orderIndex: number; items: { title: string; price: number }[] }[],
): string {
  const categoryList = buildCategoryList(categories);
  const orderList = orders
    .map((order) => {
      const items = order.items
        .map((item) => `    - "${item.title}" ($${item.price.toFixed(2)})`)
        .join("\n");
      return `  Order #${String(order.orderIndex)}:\n${items}`;
    })
    .join("\n\n");

  return `Classify each item in each Amazon order into the most appropriate category.

Available categories:
${categoryList}

Orders to classify:
${orderList}

For each order, set needsSplit to true ONLY if its items belong to different categories.

Respond with JSON:
{
  "orders": [
    {
      "orderIndex": 0,
      "items": [{ "title": "...", "price": ..., "categoryId": "...", "categoryName": "..." }],
      "needsSplit": true | false
    }
  ]
}`;
}

export function buildVenmoClassificationPrompt(
  categories: MonarchCategory[],
  matches: VenmoMatch[],
): string {
  const categoryList = buildCategoryList(categories);
  const matchList = matches
    .map((m) => {
      const direction = m.venmoTransaction.amount > 0 ? "received from" : "sent to";
      const other = m.venmoTransaction.amount > 0
        ? m.venmoTransaction.from
        : m.venmoTransaction.to;
      const date = m.venmoTransaction.datetime.split("T")[0] ?? "";
      return `  - $${Math.abs(m.venmoTransaction.amount).toFixed(2)} ${direction} ${other} | Note: "${m.venmoTransaction.note}" | Date: ${date}`;
    })
    .join("\n");

  return `Classify each Venmo payment based on the payment note and context. The note describes what the payment was for.

Available categories:
${categoryList}

Venmo payments to classify:
${matchList}

Respond with JSON:
{
  "payments": [
    {
      "note": "...",
      "amount": ...,
      "categoryId": "...",
      "categoryName": "...",
      "confidence": "high" | "medium" | "low"
    }
  ]
}`;
}
