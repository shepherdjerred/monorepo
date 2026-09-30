import { describe, expect, test } from "vitest";
import { parsePayslipPage, payslipColumns } from "./parse-payslip.ts";
import type { PdfCell, PdfLine } from "../pdf/extract.ts";

// Cells are written as [x, text, width]. Money columns are right-aligned, so
// the fixtures give each column a consistent right edge (x + width) — that is
// what the parser keys on.
type Cell = [number, string, number];

let nextY = 700;
function line(...cells: Cell[]): PdfLine {
  nextY -= 10;
  const ordered: PdfCell[] = cells.map(([x, str, width]) => ({
    x,
    str,
    width,
  }));
  return {
    page: 1,
    y: nextY,
    text: ordered.map((c) => c.str).join(" "),
    cells: ordered,
  };
}

// The current-period amount column ends at x=286 for earnings and x=528 for
// the right-hand tables; year-to-date sits well clear of both.
type PageOptions = {
  earningsTotal: string;
  summaryTax: string;
  taxSectionTotal: string;
};

const DEFAULTS: PageOptions = {
  earningsTotal: "8,046.67",
  summaryTax: "1,954.56",
  taxSectionTotal: "1,954.56",
};

function payslipPage(
  earningsRows: PdfLine[],
  options: PageOptions = DEFAULTS,
): PdfLine[] {
  nextY = 700;
  return [
    line([37, "Name", 30], [338, "Pay Period Begin", 70]),
    line(
      [37, "Jerred Shepherd", 70],
      [357, "10/01/2024", 45],
      [422, "10/15/2024", 45],
      [487, "10/15/2024", 45],
    ),
    line([172, "Hours Worked", 55], [255, "Gross Pay", 40]),
    line(
      [37, "Current", 35],
      [202, "0.00", 20],
      [261, "8,066.67", 25],
      [338, "541.01", 25],
      [405, options.summaryTax, 25],
      [490, "0.00", 20],
      [548, "5,630.38", 25],
    ),
    line([189, "Earnings", 40], [449, "Employee Taxes", 60]),
    line(
      [37, "Description", 50],
      [259, "Amount", 27],
      [328, "YTD Amount", 50],
      [373, "Description", 50],
      [505, "Amount", 23],
      [561, "YTD", 15],
    ),
    ...earningsRows,
    line(
      [38, "Earnings", 40],
      [256, options.earningsTotal, 30],
      [330, "31,963.34", 40],
      [374, "Employee Taxes", 60],
      [501, options.taxSectionTotal, 27],
      [544, "8,948.56", 30],
    ),
    line([276, "Pre Tax Deductions", 80]),
    line([37, "Description", 50], [505, "Amount", 23], [561, "YTD", 15]),
    line([37, "401(k)", 30], [508, "475.01", 20], [554, "475.01", 20]),
    line([37, "Dental", 30], [515, "5.00", 13], [557, "10.00", 16]),
    line([37, "Medical", 35], [512, "59.50", 16], [554, "119.00", 20]),
    line([37, "Vision", 30], [515, "1.50", 13], [561, "3.00", 13]),
    line(
      [38, "Pre Tax Deductions", 80],
      [506, "541.01", 22],
      [553, "607.01", 22],
    ),
    line([137, "Employer Paid Benefits", 90], [356, "Taxable Wages", 60]),
  ];
}

const TAX_ROWS: Cell[][] = [
  [
    [373, "Social Security", 60],
    [508, "496.65", 20],
    [548, "1,976.01", 25],
  ],
  [
    [373, "Medicare", 40],
    [508, "116.15", 20],
    [554, "462.13", 20],
  ],
  [
    [373, "Federal Withholding", 80],
    [502, "1,341.76", 26],
    [548, "6,341.36", 25],
  ],
];

function earningsAndTaxes(earnings: Cell[][]): PdfLine[] {
  const rows: PdfLine[] = [];
  const count = Math.max(earnings.length, TAX_ROWS.length);
  for (let i = 0; i < count; i++) {
    rows.push(line(...(earnings[i] ?? []), ...(TAX_ROWS[i] ?? [])));
  }
  return rows;
}

const CONNECTIVITY: Cell[] = [
  [37, "Connectivity Reimbursement", 120],
  [261, "130.00", 25],
  [330, "130.00", 25],
];
const SALARY: Cell[] = [
  [37, "Regular Salary Pay", 80],
  [256, "7,916.67", 30],
  [330, "15,833.34", 40],
];
// A one-time payment that did not recur: the current-period cell is not
// printed at all, and only the year-to-date figure appears.
const SIGN_ON_BONUS_YTD_ONLY: Cell[] = [
  [37, "Sign on Bonus", 60],
  [330, "15,000.00", 40],
];

describe("parsePayslipPage", () => {
  test("reads the current period, not year to date", () => {
    const page = parsePayslipPage(
      payslipColumns(payslipPage(earningsAndTaxes([CONNECTIVITY, SALARY]))),
      1,
    );
    expect(page.earnings).toEqual([
      { label: "Connectivity Reimbursement", amount: 130 },
      { label: "Regular Salary Pay", amount: 7916.67 },
    ]);
    expect(page.payDate).toBe("2024-10-15");
    expect(page.grossPay).toBe(8066.67);
    expect(page.netPay).toBe(5630.38);
  });

  test("a row that paid nothing this period is left out entirely", () => {
    const page = parsePayslipPage(
      payslipColumns(
        payslipPage(
          earningsAndTaxes([CONNECTIVITY, SIGN_ON_BONUS_YTD_ONLY, SALARY]),
        ),
      ),
      1,
    );
    // The $15,000 is the running total of a bonus paid in an earlier period.
    // Reading it here would report a signing bonus on every paycheck.
    expect(page.earnings.map((e) => e.label)).not.toContain("Sign on Bonus");
    expect(page.earnings.reduce((sum, e) => sum + e.amount, 0)).toBeCloseTo(
      8046.67,
      2,
    );
  });

  test("separates the two side-by-side tables", () => {
    const page = parsePayslipPage(
      payslipColumns(payslipPage(earningsAndTaxes([CONNECTIVITY, SALARY]))),
      1,
    );
    expect(page.taxes).toEqual([
      { label: "Social Security", amount: 496.65 },
      { label: "Medicare", amount: 116.15 },
      { label: "Federal Withholding", amount: 1341.76 },
    ]);
    expect(page.deductions).toEqual([
      { label: "401(k)", amount: 475.01 },
      { label: "Dental", amount: 5 },
      { label: "Medical", amount: 59.5 },
      { label: "Vision", amount: 1.5 },
    ]);
  });

  test("refuses a page whose rows do not add up to the printed total", () => {
    expect(() =>
      parsePayslipPage(
        payslipColumns(
          payslipPage(earningsAndTaxes([CONNECTIVITY, SALARY]), {
            ...DEFAULTS,
            earningsTotal: "9,999.99",
          }),
        ),
        1,
      ),
    ).toThrow(/sum of earnings rows/);
  });

  test("refuses a page whose section total disagrees with the summary", () => {
    expect(() =>
      parsePayslipPage(
        payslipColumns(
          payslipPage(earningsAndTaxes([CONNECTIVITY, SALARY]), {
            ...DEFAULTS,
            taxSectionTotal: "1,865.83",
          }),
        ),
        1,
      ),
    ).toThrow(/the employee taxes section total/);
  });
});
