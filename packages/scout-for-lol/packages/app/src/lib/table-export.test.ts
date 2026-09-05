import { describe, expect, test } from "vitest";
import type { ReportResultColumn } from "@scout-for-lol/data";
import { tableToCsv, type ExportableRow } from "./table-export.ts";

describe("table-export", () => {
  const columns: ReportResultColumn[] = [
    { key: "label", label: "Player", format: "text" },
    { key: "win_rate", label: "Win rate", format: "percent" },
    { key: "games", label: "Total Games", format: "integer" },
  ];

  const rows: ExportableRow[] = [
    {
      label: "Faker, The GOAT",
      values: [
        { column: "win_rate", value: 0.65 },
        { column: "games", value: 100 },
      ],
    },
    {
      label: 'Gumayusi "Guma"',
      values: [
        { column: "win_rate", value: 0.58 },
        { column: "games", value: 85 },
      ],
    },
  ];

  test("escapes fields containing commas and double quotes correctly", () => {
    const csv = tableToCsv(columns, rows);
    const lines = csv.split("\n");

    expect(lines[0]).toBe("Player,Win rate,Total Games");
    expect(lines[1]).toBe('"Faker, The GOAT",65.0%,100');
    expect(lines[2]).toBe('"Gumayusi ""Guma""",58.0%,85');
  });

  test("handles empty rows", () => {
    const csv = tableToCsv(columns, []);
    expect(csv).toBe("Player,Win rate,Total Games");
  });
});
