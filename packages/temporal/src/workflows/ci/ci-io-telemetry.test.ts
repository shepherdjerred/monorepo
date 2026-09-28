import { expect, test } from "vitest";
import { ciIoTelemetryReport } from "./ci-io-telemetry.ts";

test("reports failed CI telemetry checks with their query evidence", () => {
  const report = ciIoTelemetryReport(
    "2026-09-27T07:00:00.000Z",
    "2026-09-27T07:01:00.000Z",
    [
      {
        id: "node-io",
        query: "node_disk_written_bytes_total",
        minimumRequiredSeries: 1,
        series: 0,
        values: [],
        passed: false,
      },
    ],
  );

  expect(report).toMatchObject({
    scheduleId: "ci-io-telemetry-daily",
    execution: "complete",
    verdict: "attention",
    checks: [{ id: "node-io", status: "failed" }],
    evidence: [{ id: "node-io", status: "success" }],
  });
  expect(report.findings).toHaveLength(1);
});
