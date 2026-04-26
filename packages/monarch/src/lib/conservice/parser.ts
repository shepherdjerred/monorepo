import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import path from "node:path";
import { Glob } from "bun";
import { log } from "../logger.ts";
import type { ConserviceCharge } from "./types.ts";

const DATA_DIR = path.join(
  import.meta.dirname,
  "..",
  "..",
  "..",
  "data",
  "conservice",
);

const SUMMARY_PREFIXES = [
  "rent and leasing charges due",
  "current utility charges due",
  "total current charges",
  "prior balance",
  "grand total due",
];

function isSummaryLine(text: string): boolean {
  const lower = text.toLowerCase();
  return SUMMARY_PREFIXES.some((prefix) => lower.startsWith(prefix));
}

function serviceTypeToChargeTypeId(serviceType: string): number {
  const lower = serviceType.toLowerCase();

  if (lower === "garage") return 19;
  if (lower === "one-time concessions") return 137;
  if (lower === "rent") return 4;
  if (lower === "rent service fee") return 1132;
  if (lower === "pet rent") return 112;
  if (lower === "water heating") return 1;
  if (lower === "sewer capacity") return 30;
  if (lower === "water adjustment") return 677;
  if (lower === "sewer adjustment") return 612;
  if (lower === "trash adjustment") return 1553;
  if (lower === "common area electricity") return 6;
  if (lower === "electric based on sqft") return 32;
  if (lower === "electricity") return 38;
  if (lower === "trash") return 3;
  if (lower.startsWith("water")) return 8;
  if (lower.startsWith("sewer")) return 2;
  if (lower === "service fee") return 19;

  return 19;
}

type TextItem = { x: number; str: string };

// The charge table starts at x >= 200 in the PDF layout.
// The left column (x < 200) has account info, water usage charts, and tips.
const CHARGE_TABLE_MIN_X = 200;

type ExtractResult = {
  chargeLines: string[];
  allText: string;
};

async function extractLines(filePath: string): Promise<ExtractResult> {
  const buffer = await Bun.file(filePath).arrayBuffer();
  const doc = await getDocument({ data: new Uint8Array(buffer) }).promise;

  const chargeLines: string[] = [];
  let allText = "";

  for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
    const page = await doc.getPage(pageNum);
    const content = await page.getTextContent();

    // Group right-column items by Y coordinate for charge lines
    const lineMap = new Map<number, TextItem[]>();
    for (const rawItem of content.items) {
      if (!("str" in rawItem)) continue;
      const str = rawItem.str;
      const rawTransform: unknown = rawItem.transform;
      const tArr = Array.isArray(rawTransform) ? rawTransform : [];
      const tY: unknown = tArr[5];
      const tX: unknown = tArr[4];
      const y = Math.round(typeof tY === "number" ? tY : 0);
      const x = typeof tX === "number" ? tX : 0;

      allText += str + " ";

      if (str.trim() === "" || x < CHARGE_TABLE_MIN_X) continue;

      let lineY = y;
      for (const existingY of lineMap.keys()) {
        if (Math.abs(existingY - y) <= 3) {
          lineY = existingY;
          break;
        }
      }
      const items = lineMap.get(lineY);
      if (items) {
        items.push({ x, str });
      } else {
        lineMap.set(lineY, [{ x, str }]);
      }
    }

    const sortedLines = [...lineMap.entries()]
      .toSorted((a, b) => b[0] - a[0])
      .map(([, items]) => {
        const ordered = items.toSorted((a, b) => a.x - b.x);
        return ordered.map((i) => i.str).join("  ");
      });

    chargeLines.push(...sortedLines);
  }

  return { chargeLines, allText };
}

function parseDueDate(text: string): string | undefined {
  const match = /Due Date:\s+(\d{2})\/(\d{2})\/(\d{4})/.exec(text);
  if (!match) return undefined;
  const [, month, day, year] = match;
  if (month === undefined || day === undefined || year === undefined)
    return undefined;
  return `${year}-${month}-${day}`;
}

type ParsedCharge = {
  serviceType: string;
  amount: number;
};

// Pattern: "ServiceType  MM/DD/YYYY - MM/DD/YYYY  $amount" (charge with date range)
const CHARGE_WITH_DATE =
  /^(\S+(?:\s\S+)*)\s{2,}\d{2}\/\d{2}\/\d{4}\s*-\s*\d{2}\/\d{2}\/\d{4}\s{2,}(-?\$[\d,]+\.\d{2})$/;

// Pattern: "ServiceType  description  $amount" (e.g. Service Fee with description)
const CHARGE_WITH_DESC =
  /^(Service Fee)\s{2,}\S+(?:\s\S+)*\s{2,}(-?\$[\d,]+\.\d{2})$/;

function parseChargeLine(line: string): ParsedCharge | undefined {
  // Try charge with date range first
  let match = CHARGE_WITH_DATE.exec(line);
  if (match?.[1] !== undefined && match[2] !== undefined) {
    const serviceType = match[1].trim();
    if (isSummaryLine(serviceType)) return undefined;
    const amount = Number.parseFloat(
      match[2].replaceAll("$", "").replaceAll(",", ""),
    );
    return { serviceType, amount };
  }

  // Try service fee pattern
  match = CHARGE_WITH_DESC.exec(line);
  if (match?.[1] !== undefined && match[2] !== undefined) {
    const amount = Number.parseFloat(
      match[2].replaceAll("$", "").replaceAll(",", ""),
    );
    return { serviceType: match[1], amount };
  }

  return undefined;
}

async function parsePdf(
  filePath: string,
): Promise<{ dueDate: string; charges: ConserviceCharge[] }> {
  const { chargeLines, allText } = await extractLines(filePath);

  const dueDate = parseDueDate(allText);
  if (dueDate === undefined) {
    throw new Error(`Could not find due date in ${filePath}`);
  }

  const charges: ConserviceCharge[] = [];
  let rowNumber = 1;

  for (const line of chargeLines) {
    const parsed = parseChargeLine(line);
    if (!parsed) continue;

    charges.push({
      rowNumber,
      description: parsed.serviceType,
      chargeAmount: parsed.amount,
      paymentAmount: 0,
      monthTotal: 0,
      postMonth: dueDate,
      transactionDate: dueDate,
      chargeTypeId: serviceTypeToChargeTypeId(parsed.serviceType),
    });
    rowNumber += 1;
  }

  return { dueDate, charges };
}

export async function loadConserviceFromPdfs(
  dataDir = DATA_DIR,
): Promise<ConserviceCharge[]> {
  const glob = new Glob("ConserviceBill*.pdf");

  const files: string[] = [];
  try {
    for await (const file of glob.scan(dataDir)) {
      files.push(path.join(dataDir, file));
    }
  } catch {
    log.warn(`Conservice PDF directory not found: ${dataDir}`);
    return [];
  }
  files.sort();

  // Deduplicate by due date (same bill may be downloaded multiple times)
  const byDueDate = new Map<string, ConserviceCharge[]>();

  for (const filePath of files) {
    const { dueDate, charges } = await parsePdf(filePath);
    log.info(
      `Parsed ${path.basename(filePath)}: ${dueDate}, ${String(charges.length)} line items`,
    );
    if (!byDueDate.has(dueDate)) {
      byDueDate.set(dueDate, charges);
    }
  }

  const allCharges = [...byDueDate.values()].flat();
  log.info(
    `Loaded ${String(allCharges.length)} Conservice charges from ${String(byDueDate.size)} unique bills (${String(files.length)} PDFs)`,
  );
  return allCharges;
}
