import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import path from "node:path";
import { Glob } from "bun";
import { log } from "../logger.ts";
import type { UsaaStatement } from "./types.ts";

const DATA_DIR = path.join(
  import.meta.dirname,
  "..",
  "..",
  "..",
  "data",
  "usaa",
);

const MONTH_MAP: Record<string, string> = {
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

async function extractText(filePath: string): Promise<string> {
  const buffer = await Bun.file(filePath).arrayBuffer();
  const doc = await getDocument({ data: new Uint8Array(buffer) }).promise;

  let fullText = "";
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const parts: string[] = [];
    for (const item of content.items) {
      if ("str" in item) {
        parts.push(item.str);
      }
    }
    const pageText = parts.join(" ");
    fullText += pageText + "\n";
  }
  return fullText;
}

function parseStatementDate(text: string): string | undefined {
  const match = /Statement Date:\s*(\d{2})\/(\d{2})\/(\d{4})/.exec(text);
  if (!match) return undefined;
  const [, month, day, year] = match;
  if (month === undefined || day === undefined || year === undefined)
    return undefined;
  return `${year}-${month}-${day}`;
}

function parseDraftDate(
  text: string,
  statementDate: string,
): string | undefined {
  // Text has "Draft Amount on Mar. 7 th" (space before th/st/nd/rd)
  const match = /Draft Amount on (\w{3})\.\s*(\d{1,2})\s*(?:st|nd|rd|th)/.exec(
    text,
  );
  if (!match) return undefined;

  const monthAbbr = match[1];
  const day = match[2];
  if (monthAbbr === undefined || day === undefined) return undefined;

  const monthNum = MONTH_MAP[monthAbbr];
  if (monthNum === undefined) return undefined;

  const stmtYear = Number.parseInt(statementDate.slice(0, 4), 10);
  const stmtMonth = Number.parseInt(statementDate.slice(5, 7), 10);
  const draftMonth = Number.parseInt(monthNum, 10);
  const year = draftMonth < stmtMonth ? stmtYear + 1 : stmtYear;

  return `${String(year)}-${monthNum}-${day.padStart(2, "0")}`;
}

function parseDraftAmount(text: string): number | undefined {
  // "Draft Amount on Mar. 7 th   $328.98"
  const match =
    /Draft Amount on \w{3}\.\s*\d{1,2}\s*(?:st|nd|rd|th)\s+\$?([\d,]+\.\d{2})/.exec(
      text,
    );
  if (match?.[1] === undefined) return undefined;
  return Number.parseFloat(match[1].replaceAll(",", ""));
}

function parseAutoAmount(text: string): number | undefined {
  // "WA Auto 7101  01/15/26   to 07/15/26   1,288.31   257.66"
  const match =
    /WA Auto 7101\s+\d{2}\/\d{2}\/\d{2}\s+to\s+\d{2}\/\d{2}\/\d{2}\s+[\d,]+\.\d{2}\s+([\d,]+\.\d{2})/.exec(
      text,
    );
  if (match?.[1] === undefined) return undefined;
  return Number.parseFloat(match[1].replaceAll(",", ""));
}

function parseRentersAmount(text: string): number | undefined {
  // "WA Renters Insurance 001  07/21/25   to 07/21/26   356.59   71.32"
  const match =
    /WA Renters Insurance 001\s+\d{2}\/\d{2}\/\d{2}\s+to\s+\d{2}\/\d{2}\/\d{2}\s+[\d,]+\.\d{2}\s+([\d,]+\.\d{2})/.exec(
      text,
    );
  if (match?.[1] === undefined) return undefined;
  return Number.parseFloat(match[1].replaceAll(",", ""));
}

async function parsePdf(filePath: string): Promise<UsaaStatement> {
  const text = await extractText(filePath);

  const statementDate = parseStatementDate(text);
  if (statementDate === undefined) {
    throw new Error(`Could not find statement date in ${filePath}`);
  }

  const draftDate = parseDraftDate(text, statementDate);
  if (draftDate === undefined) {
    throw new Error(`Could not find draft date in ${filePath}`);
  }

  const totalAmount = parseDraftAmount(text);
  if (totalAmount === undefined) {
    throw new Error(`Could not find draft amount in ${filePath}`);
  }

  const autoAmount = parseAutoAmount(text);
  if (autoAmount === undefined) {
    throw new Error(`Could not find auto amount in ${filePath}`);
  }

  const rentersAmount = parseRentersAmount(text);
  if (rentersAmount === undefined) {
    throw new Error(`Could not find renters amount in ${filePath}`);
  }

  return { statementDate, draftDate, totalAmount, autoAmount, rentersAmount };
}

export async function loadUsaaStatements(): Promise<UsaaStatement[]> {
  const statements: UsaaStatement[] = [];
  const glob = new Glob("*_Auto_and_Property_Insurance_Statement.pdf");

  const files: string[] = [];
  for await (const file of glob.scan(DATA_DIR)) {
    files.push(path.join(DATA_DIR, file));
  }
  files.sort();

  for (const filePath of files) {
    const statement = await parsePdf(filePath);
    log.info(
      `Parsed ${path.basename(filePath)}: ${statement.statementDate} → draft ${statement.draftDate} $${String(statement.totalAmount)} (auto $${String(statement.autoAmount)}, renters $${String(statement.rentersAmount)})`,
    );
    statements.push(statement);
  }

  log.info(`Loaded ${String(statements.length)} USAA statements from PDFs`);
  return statements;
}
