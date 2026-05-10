/**
 * Local Layer-2 test harness for the homelab audit (no Temporal client).
 *
 * Imports `runHomelabAuditAgent` directly, runs it against the user's local
 * authenticated CLIs (`kubectl @ admin@torvalds`, `talosctl`, `tofu` via
 * `op run`, `toolkit pd/bugsink/gf`, `claude`), and either writes the
 * rendered HTML to `/tmp/...` (DRY_RUN=1) or sends through the real Postal
 * API (DRY_RUN=0).
 *
 * Usage:
 *   op run --env-file=.env.audit -- DRY_RUN=1 bun run scripts/run-homelab-audit-local.ts
 *   op run --env-file=.env.audit -- DRY_RUN=1 bun run scripts/run-homelab-audit-local.ts --sections=1,9,13
 *   op run --env-file=.env.audit -- DRY_RUN=1 bun run scripts/run-homelab-audit-local.ts --haiku
 *
 * Notes:
 *   - This bypasses Temporal entirely. No worker bundle, no schedule. The
 *     activity body is just `Bun.spawn`, which works the same on Mac as in
 *     the Linux worker pod.
 *   - For DRY_RUN=0 set RECIPIENT_EMAIL to a `+audit-test` alias so test
 *     runs are filterable in your inbox.
 *   - Set RUNBOOK_PATH=packages/docs/guides/2026-04-04_homelab-audit-runbook.md
 *     in .env.audit to use the in-tree runbook (no GitHub round-trip).
 */
import { homelabAuditActivities } from "#activities/homelab-audit.ts";
import {
  buildAuditEmailSubject,
  extractAuditSubjectCounts,
  renderAuditMarkdownToHtml,
} from "#shared/markdown-to-html.ts";
import { sendPostalEmail, resolvePostalAddresses } from "#shared/postal.ts";

type Args = {
  sections: readonly number[] | "all";
  model: string | undefined;
  date: string;
};

function parseArgs(argv: readonly string[]): Args {
  let sections: readonly number[] | "all" = "all";
  let model: string | undefined;
  let date = new Date().toISOString().slice(0, 10);
  for (const arg of argv) {
    if (arg.startsWith("--sections=")) {
      const list = arg.slice("--sections=".length);
      sections = list.split(",").map((s) => Number(s.trim()));
    } else if (arg === "--haiku") {
      model = "claude-haiku-4-5-20251001";
    } else if (arg.startsWith("--model=")) {
      model = arg.slice("--model=".length);
    } else if (arg.startsWith("--date=")) {
      date = arg.slice("--date=".length);
    } else {
      console.error(`Unknown argument: ${arg}`);
      process.exit(2);
    }
  }
  return { sections, model, date };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const dryRun = Bun.env["DRY_RUN"] === "1";

  console.warn(
    JSON.stringify({
      level: "info",
      msg: "Starting local homelab audit run",
      dryRun,
      sections: args.sections,
      model: args.model ?? "(default)",
      date: args.date,
    }),
  );

  const start = Date.now();
  const agentInput: Parameters<
    typeof homelabAuditActivities.runHomelabAuditAgent
  >[0] = {
    date: args.date,
    sections: args.sections,
  };
  if (args.model !== undefined) {
    agentInput.model = args.model;
  }
  const result = await homelabAuditActivities.runHomelabAuditAgent(agentInput);
  const elapsedSec = ((Date.now() - start) / 1000).toFixed(1);

  const counts = extractAuditSubjectCounts(result.markdown);
  const subject = buildAuditEmailSubject(args.date, counts);
  const html = renderAuditMarkdownToHtml(result.markdown);

  console.warn(
    JSON.stringify({
      level: "info",
      msg: "Agent run complete",
      elapsedSec,
      markdownBytes: result.markdown.length,
      htmlBytes: html.length,
      numTurns: result.numTurns,
      totalCostUsd: result.totalCostUsd,
      subject,
      counts: counts ?? "(parse failed)",
    }),
  );

  const ts = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
  const mdPath = `/tmp/homelab-audit-${ts}.md`;
  const htmlPath = `/tmp/homelab-audit-${ts}.html`;
  await Bun.write(mdPath, result.markdown);
  await Bun.write(htmlPath, html);

  console.warn(
    JSON.stringify({
      level: "info",
      msg: "Wrote local artifacts",
      mdPath,
      htmlPath,
    }),
  );

  if (dryRun) {
    console.warn(
      JSON.stringify({
        level: "info",
        msg: "DRY_RUN=1 — skipping Postal send",
        subject,
      }),
    );
    return;
  }

  const { recipient, sender } = resolvePostalAddresses();
  const sendResult = await sendPostalEmail({
    to: recipient,
    from: sender,
    subject,
    htmlBody: html,
    tag: "homelab-audit-test",
  });

  console.warn(
    JSON.stringify({
      level: "info",
      msg: "Email sent via Postal",
      messageId: sendResult.messageId,
      recipientId: sendResult.recipientId,
      subject: sendResult.subject,
    }),
  );
}

void (async (): Promise<void> => {
  try {
    await main();
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
})();
