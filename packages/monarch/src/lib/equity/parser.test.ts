import { describe, expect, test } from "vitest";
import { parseEquityAwardsCsv } from "./parser.ts";

const HEADER =
  '"Date","Action","Symbol","Description","Quantity","FeesAndCommissions","DisbursementElection","Amount","AwardDate","AwardId","FairMarketValuePrice","SalePrice","SharesSoldWithheldForTaxes","NetSharesDeposited","Taxes"';

const SAMPLE = [
  HEADER,
  '"06/20/2026","Lapse","PINS","Restricted Stock Lapse","711","","","","","","","","","",""',
  '"","","","","","","","","10/10/2024","200947983","$20.27","","324","387","$6,567.48"',
  '"06/20/2026","Lapse","PINS","Restricted Stock Lapse","213","","","","","","","","","",""',
  '"","","","","","","","","04/09/2025","200964430","$20.27","","97","116","$1,966.19"',
  '"03/20/2026","Lapse","PINS","Restricted Stock Lapse","213","","","","","","","","","",""',
  '"","","","","","","","","04/09/2025","200964430","$18.68","","97","116","$1,811.96"',
].join("\n");

describe("parseEquityAwardsCsv", () => {
  test("groups the awards that release on one date into one event", () => {
    const events = parseEquityAwardsCsv(SAMPLE);
    expect(events.map((e) => e.vestDate)).toEqual(["2026-03-20", "2026-06-20"]);
    expect(events[1]?.awards).toHaveLength(2);
  });

  test("takes the quantity from the parent row and the rest from the detail row", () => {
    const [, june] = parseEquityAwardsCsv(SAMPLE);
    expect(june?.awards[0]).toEqual({
      awardDate: "2024-10-10",
      awardId: "200947983",
      quantity: 711,
      fairMarketValue: 20.27,
      sharesWithheldForTaxes: 324,
      netSharesDeposited: 387,
      taxes: 6567.48,
    });
  });

  test("ignores actions that are not a lapse", () => {
    const sale = [
      HEADER,
      '"05/01/2026","Sale","PINS","Share Sale","500","","","$12,500.00","","","","$25.00","","",""',
      '"","","","","","","","","10/10/2024","200947983","","$25.00","","",""',
    ].join("\n");
    expect(parseEquityAwardsCsv(sale)).toEqual([]);
  });

  test("a parent with no detail row contributes no award", () => {
    const orphan = [
      HEADER,
      '"06/20/2026","Lapse","PINS","Restricted Stock Lapse","711","","","","","","","","","",""',
    ].join("\n");
    expect(parseEquityAwardsCsv(orphan)).toEqual([]);
  });
});
