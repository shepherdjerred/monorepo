/**
 * Outreach metrics.
 *
 * The outreach task previously emitted nothing but log lines, which is why its
 * total failure went unnoticed: the 30-day nudge was 0-for-27 and the 14-day
 * feedback ask had burned 33 of 37 guilds without messaging them, and neither
 * fact was visible without hand-joining SQL.
 *
 * `outreach_skipped_total{reason}` in particular is the metric that would have
 * caught the burn — the old code logged a skip and moved on.
 */

import { Counter, Gauge } from "prom-client";
import { registry } from "#src/metrics/registry.ts";

/** Outreach messages attempted, by ladder stage and delivery outcome. */
export const outreachMessagesTotal = new Counter({
  name: "scout_outreach_messages_total",
  help: "Outreach messages attempted, by stage and delivery status",
  labelNames: ["stage", "status"] as const,
  registers: [registry],
});

/**
 * Guilds evaluated but not messaged, by reason (`configured`, `too_soon`,
 * `budget_exhausted`, `recipient_cooldown`, `already_asked`).
 */
export const outreachSkippedTotal = new Counter({
  name: "scout_outreach_skipped_total",
  help: "Outreach evaluations that did not send, by stage and reason",
  labelNames: ["stage", "reason"] as const,
  registers: [registry],
});

/**
 * Guilds that configured a subscription within the attribution window after a
 * delivered outreach message. This is the number that tells you whether
 * outreach works at all — previously not tracked in any form.
 */
export const outreachConversionsTotal = new Gauge({
  name: "scout_outreach_conversions_total",
  help: "Guilds that created a subscription within the attribution window after a delivered outreach message, by stage",
  labelNames: ["stage"] as const,
  registers: [registry],
});

/** Guilds that have spent their entire non-core message budget. */
export const outreachBudgetExhausted = new Gauge({
  name: "scout_outreach_budget_exhausted",
  help: "Guilds whose non-core message budget is fully spent",
  registers: [registry],
});

/** Distribution of guilds across the outreach ladder (stage 0..3). */
export const outreachStageGuilds = new Gauge({
  name: "scout_outreach_stage_guilds",
  help: "Number of guilds at each outreach stage",
  labelNames: ["stage"] as const,
  registers: [registry],
});
