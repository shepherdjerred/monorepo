import type { CostcoItem } from "./types.ts";

// Matches item rows: [E?] [item_number] [item_name] [price] [tax_flag?]
// Use atomic-style pattern to avoid polynomial backtracking:
// item name = one or more words (non-whitespace) separated by single spaces
const ITEM_PATTERN = /^E?\s*(\d{2,})\s+(\S+(?:\s\S+)*)\s+(\d+\.\d{2})\s*[NYny]?$/;

// Matches discount rows: [coupon_num] / [item_number] [discount-]
const DISCOUNT_PATTERN = /\d+\s*\/\s*(\d+)\s+(\d+\.\d{2})-/;

function isHeaderOrFooter(line: string): boolean {
  return line.includes("SUBTOTAL")
    || line.includes("Total")
    || line.includes("TAX")
    || line.includes("Member");
}

export function parseReceiptLines(lines: string[]): CostcoItem[] {
  const items: CostcoItem[] = [];
  const itemNumbers: string[] = [];
  const discounts = new Map<string, number>();

  for (const line of lines) {
    if (isHeaderOrFooter(line)) continue;

    const discountMatch = DISCOUNT_PATTERN.exec(line);
    if (discountMatch?.[1] !== undefined && discountMatch[2] !== undefined) {
      const itemNumber = discountMatch[1];
      const discountAmount = Number.parseFloat(discountMatch[2]);
      if (!Number.isNaN(discountAmount)) {
        discounts.set(itemNumber, (discounts.get(itemNumber) ?? 0) + discountAmount);
      }
      continue;
    }

    const itemMatch = ITEM_PATTERN.exec(line);
    if (itemMatch?.[1] !== undefined && itemMatch[2] !== undefined && itemMatch[3] !== undefined) {
      const title = itemMatch[2].trim();
      const price = Number.parseFloat(itemMatch[3]);
      if (!Number.isNaN(price) && title.length >= 2) {
        items.push({ title, price, quantity: 1 });
        itemNumbers.push(itemMatch[1]);
      }
    }
  }

  for (const [index, item] of items.entries()) {
    const itemNumber = itemNumbers[index];
    if (itemNumber !== undefined && discounts.has(itemNumber)) {
      item.price = Math.max(0, item.price - (discounts.get(itemNumber) ?? 0));
    }
  }

  if (items.length === 0) {
    return [{ title: "Unknown Costco Warehouse Purchase", price: 0, quantity: 1 }];
  }

  return items;
}
