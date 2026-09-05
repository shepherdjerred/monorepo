import {
  formatReportDisplayValue,
  type ReportResultColumn,
} from "@scout-for-lol/data";

export type ExportableRow = {
  label: string;
  games?: number | undefined;
  values: {
    column: string;
    value: string | number | null;
  }[];
};

function escapeCsvField(value: string, protectFormula = false): string {
  const safeValue =
    protectFormula && /^[=+\-@]/u.test(value) ? `'${value}` : value;
  if (
    safeValue.includes(",") ||
    safeValue.includes('"') ||
    safeValue.includes("\n") ||
    safeValue.includes("\r")
  ) {
    return `"${safeValue.replaceAll('"', '""')}"`;
  }
  return safeValue;
}

export function tableToCsv(
  columns: ReportResultColumn[],
  rows: ExportableRow[],
): string {
  const header = columns
    .map((column) => escapeCsvField(column.label))
    .join(",");

  const lines = [header];

  for (const row of rows) {
    const cells = columns.map((column) => {
      if (column.key === "label") {
        return escapeCsvField(row.label, true);
      }
      const entry = row.values.find((val) => val.column === column.key);
      if (entry?.value == null) {
        return "";
      }
      return escapeCsvField(
        formatReportDisplayValue(column, entry.value),
        column.format === "text",
      );
    });
    lines.push(cells.join(","));
  }

  return lines.join("\n");
}

export function downloadCsv(filename: string, csvContent: string): void {
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 0);
}
