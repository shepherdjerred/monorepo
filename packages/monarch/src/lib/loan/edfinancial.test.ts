import { describe, expect, test } from "vitest";
import { parseEdfinancialCsv } from "./edfinancial.ts";

// The servicer serves this file with an HTML doctype glued to the header, and
// states every payment's split outright.
const EXPORT =
  `<!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 4.0 Transitional//EN">Date,Description,Principal,Interest,Fees,Total,\n` +
  `08/20/2026,PAYMENT,-$111.17,-$80.74,$0.00,-$191.91,\n` +
  `07/20/2026,PAYMENT,-$107.31,-$84.60,$0.00,-$191.91,\n` +
  `09/01/2023,CAPITALIZED INTEREST,$0.00,$0.00,$0.00,$0.00,\n` +
  `04/20/2021,DISBURSEMENT,"$30,187.81",$0.00,$0.00,"$30,187.81",\n`;

// A servicer correction: a reversal with positive amounts and the corrected
// payment, both dated the same day. Only the net is a real payment.
const CORRECTED =
  `Date,Description,Principal,Interest,Fees,Total,\n` +
  `07/20/2025,PAYMENT,$191.91,$0.00,$0.00,$191.91,\n` +
  `07/20/2025,PAYMENT,-$284.66,-$99.16,$0.00,-$383.82,\n` +
  `04/20/2021,DISBURSEMENT,"$30,187.81",$0.00,$0.00,"$30,187.81",\n`;

describe("parseEdfinancialCsv", () => {
  test("reads the split the servicer states, ignoring the doctype header", () => {
    const splits = parseEdfinancialCsv(EXPORT);

    expect(splits.map((s) => [s.date, s.principal, s.interest])).toEqual([
      ["2026-07-20", 107.31, 84.6],
      ["2026-08-20", 111.17, 80.74],
    ]);
    expect(splits.every((s) => s.origin === "stated")).toBe(true);
  });

  test("runs the balance down from the disbursement", () => {
    const splits = parseEdfinancialCsv(EXPORT);

    // 30,187.81 - 107.31, then - 111.17
    expect(splits[0]?.balanceAfter).toBe(30_080.5);
    expect(splits[1]?.balanceAfter).toBe(29_969.33);
  });

  test("nets a same-day reversal instead of emitting both rows", () => {
    // -284.66 + 191.91 = -92.75 principal against -99.16 interest, which is
    // the $191.91 that actually left the account.
    const splits = parseEdfinancialCsv(CORRECTED);

    expect(splits).toHaveLength(1);
    expect(splits[0]?.amount).toBe(191.91);
    expect(splits[0]?.principal).toBe(92.75);
    expect(splits[0]?.interest).toBe(99.16);
  });

  test("rejects a file whose columns do not add up", () => {
    // Misreading a column is the failure this guards: a split whose legs do
    // not sum to the payment would be written onto a real transaction.
    const wrong =
      `Date,Description,Principal,Interest,Fees,Total,\n` +
      `08/20/2026,PAYMENT,-$11.17,-$80.74,$0.00,-$191.91,\n`;

    expect(() => parseEdfinancialCsv(wrong)).toThrow(/is not the 191.91 paid/);
  });

  test("ignores a date that nets to nothing", () => {
    const reversalOnly =
      `Date,Description,Principal,Interest,Fees,Total,\n` +
      `07/20/2025,PAYMENT,$191.91,$0.00,$0.00,$191.91,\n` +
      `07/20/2025,PAYMENT,-$191.91,$0.00,$0.00,-$191.91,\n`;

    expect(parseEdfinancialCsv(reversalOnly)).toEqual([]);
  });
});
