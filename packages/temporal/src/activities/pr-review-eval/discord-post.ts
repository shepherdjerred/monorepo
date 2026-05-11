/**
 * Discord webhook post activity for the weekly A/B significance report.
 *
 * Posts a single embed-formatted message to the configured Discord
 * webhook (sourced from 1Password Connect as
 * `DISCORD_PR_REVIEW_WEBHOOK`). Failure of the webhook does NOT raise
 * to the workflow — the canonical report is the Postgres row + Prom
 * gauge; Discord is a courtesy notification. We log + return
 * `{posted: false}` so the workflow can record the failure but
 * continue.
 *
 * Direct `fetch()` is sufficient — no need for `@vermaysha/discord-webhook`
 * for a single embed. Discord rate-limits global webhooks per webhook
 * ID at ~5/sec, well above the once-a-week cadence.
 */
import { withSpan } from "#observability/tracing.ts";
import type { SignificanceReport } from "./significance.ts";

const COMPONENT = "pr-review-eval";

function jsonLog(
  level: "info" | "warning" | "error",
  message: string,
  fields: Record<string, unknown> = {},
): void {
  console.warn(
    JSON.stringify({
      level,
      msg: message,
      component: COMPONENT,
      activity: "discordPost",
      ...fields,
    }),
  );
}

// ---------------------------------------------------------------------------
// Embed builder — pure, testable
// ---------------------------------------------------------------------------

type DiscordEmbed = {
  title: string;
  description?: string;
  color: number;
  fields: { name: string; value: string; inline?: boolean }[];
  timestamp?: string;
  footer?: { text: string };
};

function formatPercent(p: number): string {
  return `${(p * 100).toFixed(1)}%`;
}

const VERDICT_COLORS = {
  // Discord embed colors are decimal-encoded RGB. Picked to match the
  // PD severity convention used elsewhere in the homelab.
  "winner-ready": 0x2e_cc_71, // green
  inconclusive: 0xf1_c4_0f, // amber
  "insufficient-data": 0x95_a5_a6, // grey
} as const;

export function buildEmbed(report: SignificanceReport): DiscordEmbed {
  const verdict = report.verdict;
  const color = VERDICT_COLORS[verdict.kind];

  let description: string;
  switch (verdict.kind) {
    case "winner-ready": {
      description = `**Winner-ready**: \`${verdict.winner}\` beats every other arm with probability **${formatPercent(verdict.probabilityWinning)}**. Promote manually via the operator runbook — auto-promotion is disabled by design.`;
      break;
    }
    case "inconclusive": {
      description = `**Inconclusive**: no arm exceeds the winner-probability threshold yet. Keep traffic flowing; next report runs Monday 09:00 PT.`;
      break;
    }
    case "insufficient-data": {
      description = `**Insufficient data**: at least one arm has fewer than ${String(verdict.minLabeledRequired)} labeled PRs in the window. Acceptance backfill from the reaction listener may still be catching up.`;
      break;
    }
  }

  const armFields = report.arms.map((arm) => ({
    name: `\`${arm.variant}\``,
    value: [
      `labeled: **${String(arm.labeledCount)}**`,
      `accepts: ${String(arm.accepts)} · dismisses: ${String(arm.dismisses)}`,
      `posterior mean: ${formatPercent(arm.posteriorMean)}`,
      `95% CI: ${formatPercent(arm.ci95Low)} – ${formatPercent(arm.ci95High)}`,
    ].join("\n"),
    inline: true,
  }));

  return {
    title: `A/B report — ${report.experimentId}`,
    description,
    color,
    fields: armFields,
    timestamp: report.windowEndedAt.toISOString(),
    footer: {
      text: `window: ${report.windowStartedAt.toISOString().slice(0, 10)} → ${report.windowEndedAt.toISOString().slice(0, 10)} · total labeled: ${String(report.totalLabeled)}`,
    },
  };
}

// ---------------------------------------------------------------------------
// Activity
// ---------------------------------------------------------------------------

export type PostDiscordReportInput = {
  report: SignificanceReport;
};

export type PostDiscordReportResult = {
  posted: boolean;
  /** Non-null only when posted=false. */
  reason?: string;
};

function webhookUrlOrUndefined(): string | undefined {
  const url = Bun.env["DISCORD_PR_REVIEW_WEBHOOK"];
  if (url === undefined || url === "") {
    return undefined;
  }
  return url;
}

async function postImpl(
  input: PostDiscordReportInput,
): Promise<PostDiscordReportResult> {
  return await withSpan(
    "prReviewEval.discordPost",
    { "experiment.id": input.report.experimentId },
    async () => {
      const url = webhookUrlOrUndefined();
      if (url === undefined) {
        // Soft-fail: workflow proceeds. Postgres row + Prom gauge are
        // the canonical signals; Discord is a courtesy.
        jsonLog("warning", "DISCORD_PR_REVIEW_WEBHOOK not set; skipping post", {
          experimentId: input.report.experimentId,
        });
        return { posted: false, reason: "webhook-not-configured" };
      }

      const embed = buildEmbed(input.report);
      const body = JSON.stringify({ embeds: [embed] });

      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
      });
      if (!response.ok) {
        // Read the body for the log; Discord returns a JSON error
        // shape (`{message, code}`). We treat all non-2xx as a soft
        // failure because the report has already been persisted.
        const text = await response.text();
        jsonLog("error", "Discord webhook returned non-2xx", {
          status: response.status,
          body: text.slice(0, 500),
          experimentId: input.report.experimentId,
        });
        return { posted: false, reason: `http-${String(response.status)}` };
      }
      jsonLog("info", "Posted A/B report to Discord", {
        experimentId: input.report.experimentId,
      });
      return { posted: true };
    },
  );
}

// ---------------------------------------------------------------------------
// Activity registry
// ---------------------------------------------------------------------------

export type EvalDiscordActivities = typeof evalDiscordActivities;

export const evalDiscordActivities = {
  async prReviewPostDiscordReport(
    input: PostDiscordReportInput,
  ): Promise<PostDiscordReportResult> {
    return postImpl(input);
  },
};
