import { describe, expect, test } from "vitest";
import { parseAudiStatement } from "./audi.ts";
import type { PdfLine } from "../pdf/extract.ts";

// These statements render through Type3 fonts, so pdfjs emits roughly one
// glyph at a time and every line arrives peppered with spaces. The fixture
// keeps that spacing: it is the thing the parser exists to survive.
function lines(...texts: string[]): PdfLine[] {
  return texts.map((text, i) => ({
    page: 1,
    y: 700 - i * 12,
    text,
    cells: [],
  }));
}

const STATEMENT = lines(
  "A cc ou n t S ta t em e n t",
  "Ac c ou n t Nu m be r : 8 1 5 42 6 0 8 8 1",
  "Pa ym en t Re c e iv e d 0 8 /0 1 /2 0 2 5 $ 1, 5 1 6. 3 6",
  "Pri nc i pa l $ 9 2 8. 6 8",
  "In te r e st $ 5 8 7. 6 8",
  "Cu rr e n t Ba la n c e* * * $ 6 5, 4 2 8. 4 1",
  "2 02 5 YT D Pr in ci p al $ 4, 3 2 5. 1 1",
  "2 02 5 YT D In t e re s t $ 3, 2 5 6. 6 9",
);

describe("parseAudiStatement", () => {
  test("reads a payment through glyph-level spacing", () => {
    expect(parseAudiStatement(STATEMENT, "Document.pdf")).toEqual({
      loanId: "8154260881",
      date: "2025-08-01",
      amount: 1516.36,
      principal: 928.68,
      interest: 587.68,
      balanceAfter: 65_428.41,
      origin: "stated",
    });
  });

  test("takes this period's principal, not the year-to-date figure", () => {
    // Both appear on the statement and YTD is the larger number, so an
    // unanchored match would overstate every split on the account.
    const split = parseAudiStatement(STATEMENT, "Document.pdf");

    expect(split?.principal).toBe(928.68);
    expect(split?.interest).toBe(587.68);
  });

  test("returns nothing for a statement issued before the first payment", () => {
    const noPayment = lines(
      "A cc ou n t S ta t em e n t",
      "Ac c ou n t Nu m be r : 8 1 5 42 6 0 8 8 1",
      "Tota l Am ount Due : $1 , 51 6. 36",
    );

    expect(parseAudiStatement(noPayment, "Document.pdf")).toBeUndefined();
  });

  test("refuses a payment whose split does not add up", () => {
    const wrong = lines(
      "Pa ym en t Re c e iv e d 0 8 /0 1 /2 0 2 5 $ 1, 5 1 6. 3 6",
      "Pri nc i pa l $ 9 2 8. 6 8",
      "In te r e st $ 8 7. 6 8",
    );

    expect(() => parseAudiStatement(wrong, "Document.pdf")).toThrow(
      /is not the 1516.36 paid/,
    );
  });

  test("refuses a payment with no breakdown at all", () => {
    const bare = lines(
      "Pa ym en t Re c e iv e d 0 8 /0 1 /2 0 2 5 $ 1, 5 1 6. 3 6",
    );

    expect(() => parseAudiStatement(bare, "Document.pdf")).toThrow(
      /no principal\/interest breakdown/,
    );
  });
});
