import { describe, expect, test } from "vitest";
import { parseCsvRow, parseCsvRows } from "./rows.ts";

describe("parseCsvRow", () => {
  test("splits plain fields", () => {
    expect(parseCsvRow("a,b,c")).toEqual(["a", "b", "c"]);
  });

  test("keeps commas inside quotes", () => {
    expect(parseCsvRow('"Shepherd, Jerred","$1,234.56"')).toEqual([
      "Shepherd, Jerred",
      "$1,234.56",
    ]);
  });

  test("preserves empty fields, including trailing ones", () => {
    expect(parseCsvRow('"06/20/2026","Lapse","","",""')).toEqual([
      "06/20/2026",
      "Lapse",
      "",
      "",
      "",
    ]);
  });

  test("trims whitespace around unquoted fields", () => {
    expect(parseCsvRow(" a , b ")).toEqual(["a", "b"]);
  });
});

describe("parseCsvRows", () => {
  test("drops blank lines", () => {
    expect(parseCsvRows("a,b\n\nc,d\n")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });
});
