import raw from "./components.json" with { type: "json" };
import { PortfolioSchema, type Component, type PricePoint } from "./schema";

export const portfolio = PortfolioSchema.parse(raw);

export function sortedHistory(c: Component): readonly PricePoint[] {
  return [...c.history].sort((a, b) => a.date.localeCompare(b.date));
}

export function currentPrice(c: Component): number {
  const hist = sortedHistory(c);
  const last = hist.at(-1);
  if (!last) throw new Error(`no history for ${c.slug}`);
  return last.price;
}

export function quantity(c: Component): number {
  return c.purchases.reduce((sum, p) => sum + p.quantity, 0);
}

export function costBasis(c: Component): number {
  return c.purchases.reduce((sum, p) => sum + p.quantity * p.pricePaid, 0);
}

export function avgPurchasePrice(c: Component): number {
  const q = quantity(c);
  if (q === 0) throw new Error(`no purchases for ${c.slug}`);
  return costBasis(c) / q;
}

export function lineTotal(c: Component): number {
  return currentPrice(c) * quantity(c);
}

export function pctChange(from: number, to: number): number {
  return ((to - from) / from) * 100;
}

export function portfolioCurrentTotal(): number {
  return portfolio.components.reduce((sum, c) => sum + lineTotal(c), 0);
}

export function portfolioCostBasis(): number {
  return portfolio.components.reduce((sum, c) => sum + costBasis(c), 0);
}

function quantityOwnedAt(c: Component, date: string): number {
  return c.purchases
    .filter((p) => p.date <= date)
    .reduce((sum, p) => sum + p.quantity, 0);
}

function priceAt(c: Component, date: string): number {
  const hist = sortedHistory(c);
  let price = hist[0]?.price ?? 0;
  for (const p of hist) {
    if (p.date <= date) price = p.price;
    else break;
  }
  return price;
}

export interface PortfolioPoint {
  date: string;
  value: number;
}

export function portfolioHistory(): PortfolioPoint[] {
  const dateSet = new Set<string>();
  for (const c of portfolio.components) {
    for (const p of c.history) dateSet.add(p.date);
    for (const p of c.purchases) dateSet.add(p.date);
  }
  const dates = Array.from(dateSet).sort();

  return dates.map((date) => {
    let value = 0;
    for (const c of portfolio.components) {
      const owned = quantityOwnedAt(c, date);
      if (owned === 0) continue;
      value += owned * priceAt(c, date);
    }
    return { date, value };
  });
}

export function formatUsd(n: number): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

export function formatUsdCents(n: number): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function formatPct(n: number): string {
  const sign = n >= 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}
