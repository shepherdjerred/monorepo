import { describe, expect, test } from "bun:test";
import { getScoutRuleGroups } from "./scout.ts";

describe("Scout bot-health alert rules", () => {
  const botHealth = getScoutRuleGroups().find(
    (group) => group.name === "scout-bot-health",
  );

  test("defines the scout-bot-health group", () => {
    if (botHealth === undefined) {
      throw new Error("Missing scout-bot-health rule group");
    }
    expect(botHealth.rules).toBeDefined();
  });

  test("pages when the bot is disconnected from Discord", () => {
    const rule = botHealth?.rules?.find(
      (candidate) => candidate.alert === "ScoutDiscordDisconnected",
    );
    if (rule === undefined) {
      throw new Error("Missing ScoutDiscordDisconnected rule");
    }
    expect(rule.labels?.["severity"]).toBe("critical");
    // Expr is rendered via PrometheusRuleSpecGroupsRulesExpr.fromString.
    expect(JSON.stringify(rule.expr)).toContain("discord_connection_status");
  });

  test("warns when a cron job stalls", () => {
    const rule = botHealth?.rules?.find(
      (candidate) => candidate.alert === "ScoutCronJobStale",
    );
    if (rule === undefined) {
      throw new Error("Missing ScoutCronJobStale rule");
    }
    expect(rule.labels?.["severity"]).toBe("warning");
    expect(JSON.stringify(rule.expr)).toContain(
      "cron_job_last_success_timestamp",
    );
  });

  test("warns on a delivery-blocked spike", () => {
    const rule = botHealth?.rules?.find(
      (candidate) => candidate.alert === "ScoutGuildDeliveryBlockedSpike",
    );
    if (rule === undefined) {
      throw new Error("Missing ScoutGuildDeliveryBlockedSpike rule");
    }
    expect(JSON.stringify(rule.expr)).toContain("guild_send_blocked_total");
  });
});
