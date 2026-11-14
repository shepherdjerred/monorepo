/** Text rendering of namespace reports. */
import {
  CHECK_IDS,
  type CheckStatus,
  type NamespaceReport,
} from "./namespace-checks.ts";
import { effectiveStageLabel } from "./break-glass.ts";

const STATUS_LABELS: Record<CheckStatus, string> = {
  pass: "PASS",
  fail: "FAIL",
  "not-checked": "NOT CHECKED",
  info: "INFO",
};

function resultLabel(report: NamespaceReport): string {
  if (!report.ok) {
    return "FAIL";
  }
  return report.checks.some((check) => check.status === "not-checked")
    ? "PASS (with unchecked)"
    : "PASS";
}

export function alignedRows(rows: readonly (readonly string[])[]): string[] {
  const widths = rows.reduce<number[]>(
    (current, row) =>
      row.map((cell, index) => Math.max(current[index] ?? 0, cell.length)),
    [],
  );
  return rows.map((row) =>
    row
      .map((cell, index) => cell.padEnd(widths[index] ?? 0))
      .join("  ")
      .trimEnd(),
  );
}

/** The full report of one namespace. */
export function renderReport(report: NamespaceReport): string {
  const rows = alignedRows(
    report.checks.map((check) => [
      STATUS_LABELS[check.status],
      check.check,
      check.summary,
    ]),
  );
  return [
    `Namespace ${report.namespace}`,
    ...report.checks.flatMap((check, index) => [
      rows[index] ?? "",
      ...check.details.map((detail) => `    - ${detail}`),
    ]),
    `Result: ${resultLabel(report)}`,
  ].join("\n");
}

/** One row per namespace, then the details of every failed check. */
export function renderTable(reports: readonly NamespaceReport[]): string {
  const checkCells = (report: NamespaceReport): string[] =>
    CHECK_IDS.filter((id) => id !== "stage").map((id) => {
      const check = report.checks.find((entry) => entry.check === id);
      return check === undefined ? "-" : STATUS_LABELS[check.status];
    });
  const table = alignedRows([
    [
      "NAMESPACE",
      "STAGE",
      ...CHECK_IDS.filter((id) => id !== "stage").map((id) => id.toUpperCase()),
      "RESULT",
    ],
    ...reports.map((report) => [
      report.namespace,
      effectiveStageLabel(report.stage, report.breakGlass),
      ...checkCells(report),
      resultLabel(report),
    ]),
  ]);
  const failures = reports.flatMap((report) =>
    report.checks.flatMap((check) =>
      check.status === "fail"
        ? [
            `${report.namespace} ${check.check}: ${check.summary}`,
            ...check.details.map((detail) => `    - ${detail}`),
          ]
        : [],
    ),
  );
  const failed = reports.filter((report) => !report.ok).length;
  return [
    ...table,
    "",
    ...failures,
    `${String(reports.length - failed)}/${String(reports.length)} namespaces pass`,
  ].join("\n");
}
