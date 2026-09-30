import type { PdfLine } from "../pdf/extract.ts";
import { clipLines } from "../pdf/extract.ts";
import {
  cellRight,
  firstMoneyCell,
  moneyAtColumn,
  parseMoneyRow,
  parseUsDate,
} from "../pdf/money.ts";
import type { Payslip, PayslipLine } from "./types.ts";

// Parses one Workday payslip page. Pure: callers hand in already-extracted
// lines so this is testable without a PDF.
//
// Layout notes that drive the implementation:
//  - The page carries two tables side by side ("Earnings" left, "Employee
//    Taxes" right) which share y-rows, so a full-width line contains cells
//    from both. Section headings are found in an x-clipped view.
//  - The "Current" summary row is positional: hours, gross, pre-tax
//    deductions, employee taxes, post-tax deductions, net.
//  - Every detail table prints a current-period amount and a year-to-date
//    amount, and a row with nothing in the current period omits that cell
//    rather than printing zero. So amounts are read by column position, never
//    by ordinal position — otherwise a one-time payment like a signing bonus
//    reads as if it recurred every period, at its running total.
//  - Where a section sits depends on whether it has a neighbour: Pre Tax
//    Deductions spans the page when it is alone and shifts to the left half
//    when a Post Tax Deductions table appears beside it. Columns are therefore
//    located per page from each section's own total row, not from fixed
//    coordinates.
//  - Earnings rows vary per period, so the row set is treated as open-ended.

const SUMMARY_VALUE_COUNT = 6;
const IDENTITY_TOLERANCE = 0.02;

// The Earnings table ends and the Employee Taxes table begins around x=370
// (measured: Earnings spans 37-350, Employee Taxes 373-561). Both headings sit
// on one y-row, so telling the sections apart needs this split; the amounts
// within them are located per page.
const COLUMN_SPLIT_X = 370;
const PAGE_WIDTH = 612;

export type PayslipColumns = {
  all: PdfLine[];
  left: PdfLine[];
  right: PdfLine[];
};

// The three views one payslip page is read through.
export function payslipColumns(lines: PdfLine[]): PayslipColumns {
  return {
    all: lines,
    left: clipLines(lines, 0, COLUMN_SPLIT_X),
    right: clipLines(lines, COLUMN_SPLIT_X, PAGE_WIDTH),
  };
}

export function isPayslipPage(lines: PdfLine[]): boolean {
  return lines.some((l) => l.text.includes("Pay Period Begin"));
}

function findDates(lines: PdfLine[]): {
  periodStart: string;
  periodEnd: string;
  payDate: string;
} {
  // The row under the header carries period begin, period end, check date.
  for (const line of lines) {
    const dates = [...line.text.matchAll(/\d{2}\/\d{2}\/\d{4}/g)].map((m) =>
      parseUsDate(m[0]),
    );
    if (dates.length >= 3) {
      const [start, end, pay] = dates;
      if (start !== undefined && end !== undefined && pay !== undefined) {
        return { periodStart: start, periodEnd: end, payDate: pay };
      }
    }
  }
  throw new Error("payslip page has no header row with three dates");
}

function findSummary(lines: PdfLine[]): {
  hours: number;
  grossPay: number;
  preTaxDeductions: number;
  employeeTaxes: number;
  postTaxDeductions: number;
  netPay: number;
} {
  const current = lines.find((l) => /^Current\b/.test(l.text));
  if (!current) throw new Error("payslip page has no Current summary row");
  const values = parseMoneyRow(current.text);
  if (values.length < SUMMARY_VALUE_COUNT) {
    throw new Error(
      `Current row has ${String(values.length)} values, expected ${String(SUMMARY_VALUE_COUNT)}`,
    );
  }
  const [hours, grossPay, preTaxDeductions, employeeTaxes, postTaxDeductions] =
    values;
  const netPay = values.at(-1);
  if (
    hours === undefined ||
    grossPay === undefined ||
    preTaxDeductions === undefined ||
    employeeTaxes === undefined ||
    postTaxDeductions === undefined ||
    netPay === undefined
  ) {
    throw new Error("Current row is missing summary values");
  }
  return {
    hours,
    grossPay,
    preTaxDeductions,
    employeeTaxes,
    postTaxDeductions,
    netPay,
  };
}

// Earnings rows carry a pay-period range and bare hours/rate columns between
// the description and the first money value; strip both.
function cleanRowLabel(text: string): string {
  return text
    .slice(0, text.search(/\(?-?\$?\s*[\d,]+\.\d{2}/))
    .replace(/\d{2}\/\d{2}\/\d{4}\s*-\s*\d{2}\/\d{2}\/\d{4}/, "")
    .replace(/(?:\s+\d+(?:\.\d+)?)+\s*$/, "")
    .trim();
}

function rowFromLine(
  line: PdfLine,
  startLabel: string,
  amountColumnRight: number,
): PayslipLine | undefined {
  const label = cleanRowLabel(line.text);
  // Require a letter so numeric column fragments never become labels, but
  // without dropping real labels that open with a digit, e.g. "401(k)".
  if (!/[a-z]/i.test(label)) return undefined;
  // The section's own total row repeats the section name; it is the
  // cross-check, not an item.
  if (label === startLabel) return undefined;
  // Nothing in the current-period column means the row did not pay this
  // period — it is on the page only for its year-to-date total.
  const amount = moneyAtColumn(line.cells, amountColumnRight);
  return amount === undefined ? undefined : { label, amount };
}

export type PayslipSection = {
  rows: PayslipLine[];
  // The section's own printed current-period total. Absent when the section
  // does not appear on this payslip at all.
  total: number | undefined;
};

// A section is "<label>" heading, "Description | ... | Amount | YTD" rows, and
// a "<label> <current total> <ytd total>" row that closes it.
function parseSection(
  lines: PdfLine[],
  startLabel: string,
  stopLabels: string[],
): PayslipSection {
  const body: PdfLine[] = [];
  let totalLine: PdfLine | undefined;
  let started = false;

  for (const line of lines) {
    if (!started) {
      if (line.text.startsWith(startLabel)) started = true;
      continue;
    }
    if (stopLabels.some((stop) => line.text.startsWith(stop))) break;
    if (line.text.startsWith("Description")) continue;
    if (cleanRowLabel(line.text) === startLabel) {
      totalLine = line;
      break;
    }
    body.push(line);
  }

  if (totalLine === undefined) return { rows: [], total: undefined };
  const totalCell = firstMoneyCell(totalLine.cells);
  if (totalCell === undefined) return { rows: [], total: undefined };

  const amountColumnRight = cellRight(totalCell);
  return {
    rows: body
      .map((line) => rowFromLine(line, startLabel, amountColumnRight))
      .filter((row) => row !== undefined),
    total: moneyAtColumn(totalLine.cells, amountColumnRight),
  };
}

// Which payslip a failure is about, so an error names the page and the date.
type PageRef = { page: number; payDate: string };

function assertAgrees(
  ref: PageRef,
  what: string,
  actual: number | undefined,
  expected: number,
): void {
  if (actual === undefined) return;
  if (Math.abs(actual - expected) <= IDENTITY_TOLERANCE) return;
  throw new Error(
    `payslip page ${String(ref.page)} (${ref.payDate}): ${what} is ${actual.toFixed(2)} but should be ${expected.toFixed(2)}`,
  );
}

function assertSection(
  ref: PageRef,
  what: string,
  section: PayslipSection,
  summaryValue: number,
): void {
  assertAgrees(ref, `the ${what} section total`, section.total, summaryValue);
  // A section the summary says is nonzero must have been found. Accepting an
  // absent total here would write a payslip missing its earnings, taxes or
  // deductions and call the reconciliation satisfied.
  if (section.total === undefined) {
    if (Math.abs(summaryValue) > IDENTITY_TOLERANCE) {
      throw new Error(
        `payslip page ${String(ref.page)} (${ref.payDate}): the summary reports ${summaryValue.toFixed(2)} of ${what} but no ${what} section was found`,
      );
    }
    return;
  }
  assertAgrees(
    ref,
    `the sum of ${what} rows`,
    section.rows.reduce((sum, row) => sum + row.amount, 0),
    section.total,
  );
}

export function parsePayslipPage(
  columns: PayslipColumns,
  page: number,
): Payslip {
  const { periodStart, periodEnd, payDate } = findDates(columns.all);
  const summary = findSummary(columns.all);

  const earnings = parseSection(columns.left, "Earnings", [
    "Pre Tax Deductions",
    "Employer Paid Benefits",
  ]);
  const taxes = parseSection(columns.right, "Employee Taxes", [
    "Taxable Wages",
    "Employer Paid",
  ]);
  // Pre-tax deductions sit below the side-by-side region. Which half of the
  // page they occupy varies, so they are read from the unclipped view.
  const deductions = parseSection(columns.all, "Pre Tax Deductions", [
    "Employer Paid Benefits",
    "Taxable Wages",
  ]);

  // Verify the parse, not payroll semantics. Each section's rows must add up
  // to its own printed total, and that total must agree with the summary row.
  // Together those catch the two ways this parser can silently go wrong —
  // reading the year-to-date column instead of the current one, and pulling
  // rows from the wrong side of the two side-by-side tables. Relating gross to
  // net is deliberately NOT asserted, and neither is earnings against Gross
  // Pay: Workday excludes non-taxable reimbursements from Gross Pay and
  // includes imputed income in it, so those relationships require modelling
  // tax treatment rather than checking arithmetic. Whether net is right is
  // settled against the actual bank deposit by the matcher.
  const ref: PageRef = { page, payDate };
  assertSection(ref, "employee taxes", taxes, summary.employeeTaxes);
  assertSection(
    ref,
    "pre-tax deductions",
    deductions,
    summary.preTaxDeductions,
  );
  assertAgrees(
    ref,
    "the sum of earnings rows",
    earnings.rows.reduce((sum, row) => sum + row.amount, 0),
    earnings.total ?? 0,
  );

  return {
    payDate,
    periodStart,
    periodEnd,
    ...summary,
    earnings: earnings.rows,
    taxes: taxes.rows,
    deductions: deductions.rows,
    sourcePage: page,
  };
}
