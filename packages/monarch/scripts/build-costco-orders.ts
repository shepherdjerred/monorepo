// Rebuild the Costco order cache from the receipt PDFs in the finance vault.
//
//   bun run scripts/build-costco-orders.ts
//
// Reads every "*.pdf" in the vault's Costco folder and writes
// costco-orders.json next to them. Receipt PDFs must be named
// "YYYY-MM-DD_Costco_<location>_<kind>_..._<total>.pdf" ("Online" and "Gas"
// in the name select those layouts). Each warehouse receipt is validated:
// the parsed item prices must sum to the printed SUBTOTAL, and the parsed
// total must match the total encoded in the filename.
import path from "node:path";
import { Glob } from "bun";
import { COSTCO_DIR, COSTCO_ORDERS_PATH } from "../src/lib/finance-vault.ts";
import { readPdfPages } from "../src/lib/pdf/extract.ts";

type Item = { title: string; price: number; quantity: number };
type Order = {
  orderId: string;
  date: string;
  total: number;
  items: Item[];
  source: "online" | "warehouse";
};

// The shared extractor validates pdfjs's text items with Zod at the boundary
// and groups them into lines. Asserting their shape here instead would bypass
// the repo's no-assertions rule in a directory ESLint does not cover.
async function extractLines(pdfPath: string): Promise<string[]> {
  const pages = await readPdfPages(pdfPath);
  return pages
    .flatMap((page) => page.lines.map((line) => line.text))
    .filter((line) => line !== "");
}

const ITEM_ROW = /^[EF]?\s*(\d{2,})\s+(\S.*?\S|\S)\s+(\d+\.\d{2})\s*[NYny]?$/;
const BARE_ITEM_ROW = /^[EF]?\s*(\d{2,})\s+(\d+\.\d{2})\s*[NY]?$/;
const QTY_ROW = /^(\d+)\s*@\s*(\d+\.\d{2})$/;
const DISCOUNT_ROW = /^(\d+)\s*\/\s*(\S+)\s+(\d+\.\d{2})-$/;
const SUBTOTAL_ROW = /^SUBTOTAL\s+(\d+\.\d{2})$/;
const TOTAL_ROW = /^\*{4} TOTAL\s+(\d+\.\d{2})$/;

function isNoise(line: string): boolean {
  return (
    /costco\.com|Page \d+ of|Member|CHIP|APPROVED|AMOUNT:|VISA|CHANGE|TOTAL TAX|ITEMS SOLD|Items Sold|INSTANT SAVINGS|Thank You|Please Come|Whse:|^P7 |^TAX |^\(A\)|^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}|^\d{20,}$|WA 98\d{3}|COSTCO DR|AVE NE|ST$|#\d+$/.test(
      line,
    ) || /^(TUKWILA|KIRKLAND|SEATTLE|LYNNWOOD|AURORA|SHORELINE)/i.test(line)
  );
}

function parseWarehouse(name: string, lines: string[]): Order {
  const items: Item[] = [];
  const byNumber = new Map<string, Item>();
  let pendingQty: { quantity: number } | null = null;
  let subtotal: number | null = null;
  let total: number | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const sub = SUBTOTAL_ROW.exec(line);
    if (sub?.[1] !== undefined) {
      subtotal = Number(sub[1]);
      continue;
    }
    const tot = TOTAL_ROW.exec(line);
    if (tot?.[1] !== undefined) {
      total = Number(tot[1]);
      continue;
    }
    if (subtotal !== null) continue; // items only appear before SUBTOTAL

    const qty = QTY_ROW.exec(line);
    if (qty?.[1] !== undefined) {
      pendingQty = { quantity: Number(qty[1]) };
      continue;
    }

    // "coupon / item-number-or-name-fragment amount-"
    const disc = DISCOUNT_ROW.exec(line);
    if (disc?.[2] !== undefined && disc[3] !== undefined) {
      const target =
        byNumber.get(disc[2]) ??
        items.find((it) => it.title.includes(disc[2] ?? ""));
      if (!target) {
        throw new Error(`${name}: discount for unknown item ${disc[2]}`);
      }
      target.price = Number((target.price - Number(disc[3])).toFixed(2));
      continue;
    }

    // Wrapped discount: "/NAME" fragments on neighbor lines around a bare
    // "coupon amount-" row; applies to the most recent item.
    const bareDisc = /^(\d+)\s+(\d+\.\d{2})-$/.exec(line);
    if (bareDisc?.[2] !== undefined) {
      const target = items[items.length - 1];
      if (!target) throw new Error(`${name}: bare discount with no prior item`);
      target.price = Number((target.price - Number(bareDisc[2])).toFixed(2));
      continue;
    }
    if (line.startsWith("/")) continue; // wrapped discount name fragment

    const full = ITEM_ROW.exec(line);
    if (
      full?.[1] !== undefined &&
      full[2] !== undefined &&
      full[3] !== undefined
    ) {
      const item: Item = {
        title: full[2],
        price: Number(full[3]),
        quantity: pendingQty?.quantity ?? 1,
      };
      pendingQty = null;
      items.push(item);
      byNumber.set(full[1], item);
      continue;
    }

    // Item row whose name wrapped onto the neighboring lines
    const bare = BARE_ITEM_ROW.exec(line);
    if (bare?.[1] !== undefined && bare[2] !== undefined) {
      const nameParts: string[] = [];
      const prev = lines[i - 1] ?? "";
      const next = lines[i + 1] ?? "";
      const isPlainText = (s: string) =>
        s !== "" &&
        !isNoise(s) &&
        !ITEM_ROW.test(s) &&
        !BARE_ITEM_ROW.test(s) &&
        !QTY_ROW.test(s) &&
        !DISCOUNT_ROW.test(s) &&
        !SUBTOTAL_ROW.test(s) &&
        !TOTAL_ROW.test(s) &&
        !/\d+\.\d{2}/.test(s);
      if (isPlainText(prev)) nameParts.push(prev);
      if (isPlainText(next)) {
        nameParts.push(next);
        i++;
      }
      if (nameParts.length === 0) {
        throw new Error(`${name}: bare item row with no name: ${line}`);
      }
      const item: Item = {
        title: nameParts.join(" "),
        price: Number(bare[2]),
        quantity: pendingQty?.quantity ?? 1,
      };
      pendingQty = null;
      items.push(item);
      byNumber.set(bare[1], item);
    }
  }

  if (subtotal === null || total === null) {
    throw new Error(`${name}: missing SUBTOTAL or TOTAL`);
  }
  const sum = Number(items.reduce((a, it) => a + it.price, 0).toFixed(2));
  if (Math.abs(sum - subtotal) > 0.005) {
    throw new Error(
      `${name}: item sum ${String(sum)} != subtotal ${String(subtotal)}`,
    );
  }
  return {
    orderId: name.replace(/\.pdf$/, ""),
    date: name.slice(0, 10),
    total,
    items,
    source: "warehouse",
  };
}

function parseGas(name: string, lines: string[]): Order {
  const totalLine = lines.find((l) => l.startsWith("Total Sale"));
  const m = /\$(\d+\.\d{2})/.exec(totalLine ?? "");
  if (m?.[1] === undefined) throw new Error(`${name}: no Total Sale`);
  const total = Number(m[1]);
  return {
    orderId: name.replace(/\.pdf$/, ""),
    date: name.slice(0, 10),
    total,
    items: [
      { title: "Kirkland Signature Fuel (Regular)", price: total, quantity: 1 },
    ],
    source: "warehouse",
  };
}

function parseOnline(name: string, lines: string[]): Order {
  const totalLine = lines.find((l) => l.startsWith("Order Total"));
  const tm = /\$(\d+\.\d{2})/.exec(totalLine ?? "");
  if (tm?.[1] === undefined) throw new Error(`${name}: no Order Total`);
  const orderIdLine = lines.find((l) => /^\d{9,}\s/.test(l));
  const om = /^(\d{9,})/.exec(orderIdLine ?? "");
  // Item row: "<title start> <qty> <status> $<price>", its title continuing on
  // the following lines until "Item #", a price line, or the next item row.
  // Every row is read: taking only the first described a mixed-category order
  // by one product, and left computeSplits nothing to split it over.
  const itemRow = /^(.*?)\s+(\d+)\s+\w+\s+\$(\d+\.\d{2})$/;
  const itemIndexes = lines
    .map((l, i) => (itemRow.test(l) ? i : -1))
    .filter((i) => i >= 0);
  if (itemIndexes.length === 0) throw new Error(`${name}: no item row`);

  const items = itemIndexes.map((itemIdx, n) => {
    const row = lines[itemIdx] ?? "";
    const rm = itemRow.exec(row);
    if (
      !rm ||
      rm[1] === undefined ||
      rm[2] === undefined ||
      rm[3] === undefined
    ) {
      throw new Error(`${name}: bad item row: ${row}`);
    }
    const stop = itemIndexes[n + 1] ?? lines.length;
    const continuation: string[] = [];
    for (let i = itemIdx + 1; i < stop; i++) {
      const l = lines[i] ?? "";
      if (l.startsWith("Item #") || l.startsWith("$")) break;
      continuation.push(l);
    }
    return {
      title: [rm[1], ...continuation].join(" "),
      price: Number(rm[3]),
      quantity: Number(rm[2]),
    };
  });

  return {
    orderId: om?.[1] ?? name.replace(/\.pdf$/, ""),
    date: name.slice(0, 10),
    total: Number(tm[1]),
    items,
    source: "online",
  };
}

const orders: Order[] = [];
const glob = new Glob("*.pdf");
const files: string[] = [];
for await (const f of glob.scan(COSTCO_DIR)) files.push(f);
files.sort();
if (files.length === 0) {
  throw new Error(`No PDFs found in ${COSTCO_DIR}`);
}

for (const f of files) {
  const lines = await extractLines(path.join(COSTCO_DIR, f));
  const order = f.includes("Online")
    ? parseOnline(f, lines)
    : f.includes("Gas")
      ? parseGas(f, lines)
      : parseWarehouse(f, lines);
  // Cross-check against the total encoded in the filename. Online orders are
  // named by item sticker price, not the charged total, so skip those.
  const fm = /_(\d+\.\d{2})\.pdf$/.exec(f);
  if (
    fm?.[1] !== undefined &&
    !f.includes("Online") &&
    Number(fm[1]) !== order.total
  ) {
    throw new Error(
      `${f}: parsed total ${String(order.total)} != filename ${fm[1]}`,
    );
  }
  console.log(
    `${f}: total=${String(order.total)} items=${String(order.items.length)}`,
  );
  orders.push(order);
}

await Bun.write(
  COSTCO_ORDERS_PATH,
  `${JSON.stringify({ scrapedAt: new Date().toISOString(), orders }, null, 2)}\n`,
);
console.log(`\nWrote ${String(orders.length)} orders to ${COSTCO_ORDERS_PATH}`);
