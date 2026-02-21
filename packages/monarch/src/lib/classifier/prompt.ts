import type { MonarchCategory, MerchantGroup } from "../monarch/types.ts";

let userHints = "";

export function setUserHints(hints: string): void {
  userHints = hints;
}

export function buildSystemPrompt(): string {
  const base = `You are a personal finance categorization expert. Your job is to classify financial transactions into the correct categories based on the merchant name, bank description, and any additional context provided.

Rules:
- Always respond with valid JSON (no markdown fences, no extra text)
- Use only category IDs from the provided list
- If a merchant clearly fits one category, classify with high confidence
- If a merchant sells across many categories (Costco, Walmart, Target, Amazon), mark as ambiguous
- For Amazon items, classify based on the specific item, not the merchant`;

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

export function buildMerchantBatchPrompt(
  categories: MonarchCategory[],
  merchants: MerchantGroup[],
): string {
  const categoryList = buildCategoryList(categories);
  const merchantList = merchants
    .map((m) => {
      const plaidInfo =
        m.plaidNames.length > 0
          ? ` | Bank names: ${m.plaidNames.join(", ")}`
          : "";
      return `  - "${m.merchantName}" (${String(m.count)} txns, $${m.totalAmount.toFixed(2)})${plaidInfo}`;
    })
    .join("\n");

  return `Classify each merchant into the most appropriate category.

Available categories:
${categoryList}

Merchants to classify:
${merchantList}

Respond with JSON:
{
  "merchants": [
    {
      "merchantName": "...",
      "categoryId": "...",
      "categoryName": "...",
      "confidence": "high" | "medium" | "low",
      "ambiguous": true | false,
      "reason": "optional reason for ambiguous merchants"
    }
  ]
}`;
}

export function buildAmazonItemPrompt(
  categories: MonarchCategory[],
  items: { title: string; price: number }[],
): string {
  const categoryList = buildCategoryList(categories);
  const itemList = items
    .map((item) => `  - "${item.title}" ($${item.price.toFixed(2)})`)
    .join("\n");

  return `Classify each Amazon purchase item into the most appropriate category.

Available categories:
${categoryList}

Items to classify:
${itemList}

Respond with JSON:
{
  "items": [
    {
      "title": "...",
      "price": ...,
      "categoryId": "...",
      "categoryName": "..."
    }
  ],
  "needsSplit": true | false
}

Set needsSplit to true ONLY if items belong to different categories.`;
}
