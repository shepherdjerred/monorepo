/**
 * Local deterministic homelab audit harness (no Temporal client).
 *
 * The harness executes the same typed collectors and report builder as the
 * scheduled workflow. DRY_RUN=1 writes compact report artifacts to /tmp;
 * otherwise delivery still goes through the shared report sender.
 */
import { collectHomelabAuditEvidence } from "#activities/homelab/homelab-audit-collectors.ts";
import { buildHomelabAuditReport } from "#activities/homelab/homelab-audit-report.ts";
import { synthesizeHomelabAuditEvidence } from "#activities/homelab/homelab-audit-synthesis.ts";
import { deliverReport } from "#activities/reports/report-delivery.ts";
import { reportSubject } from "#shared/reports/report-presentation.ts";
import {
  renderReportHtml,
  renderReportText,
} from "#shared/reports/report-renderer.ts";
import { ReportEnvelopeV1Schema } from "#shared/reports/report.ts";

function parseDate(argv: readonly string[]): string {
  let date = new Date().toISOString().slice(0, 10);
  for (const argument of argv) {
    if (!argument.startsWith("--date=")) {
      throw new Error(`Unknown argument: ${argument}`);
    }
    date = argument.slice("--date=".length);
  }
  return date;
}

async function main(): Promise<void> {
  const date = parseDate(process.argv.slice(2));
  const dryRun = Bun.env["DRY_RUN"] === "1";
  const collection = await collectHomelabAuditEvidence();
  const synthesis = await synthesizeHomelabAuditEvidence(collection);
  const input = buildHomelabAuditReport(collection, synthesis);
  const runId = crypto.randomUUID();
  const report = ReportEnvelopeV1Schema.parse({
    ...input,
    schemaVersion: 1,
    reportRunId: `homelab-audit-local:${runId}`,
    title: `Local homelab audit ${date}`,
    completedAt: new Date().toISOString(),
    provenance: {
      ...input.provenance,
      workflowId: "local-homelab-audit",
      runId,
      source: "local deterministic audit harness",
    },
  });
  const subject = reportSubject(report);
  const timestamp = new Date()
    .toISOString()
    .replaceAll(":", "-")
    .replaceAll(".", "-");
  const textPath = `/tmp/homelab-audit-${timestamp}.txt`;
  const htmlPath = `/tmp/homelab-audit-${timestamp}.html`;
  await Bun.write(textPath, renderReportText(report));
  await Bun.write(htmlPath, renderReportHtml(report));
  console.warn(
    JSON.stringify({
      level: "info",
      message: "Local deterministic homelab audit completed",
      dryRun,
      subject,
      textPath,
      htmlPath,
    }),
  );
  if (dryRun) return;
  const result = await deliverReport(report);
  console.warn(
    JSON.stringify({
      level: "info",
      message: "Report accepted by Postal through shared delivery",
      subject: result.subject,
      messageId: result.messageId,
      deduplicated: result.deduplicated,
    }),
  );
}

void (async (): Promise<void> => {
  try {
    await main();
  } catch (error: unknown) {
    console.error(error);
    process.exitCode = 1;
  }
})();
