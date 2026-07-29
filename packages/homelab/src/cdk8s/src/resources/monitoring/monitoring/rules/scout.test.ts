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

  test("warns 14 days before production season metadata expires", () => {
    const rule = botHealth?.rules?.find(
      (candidate) => candidate.alert === "ScoutSeasonScheduleExpiring",
    );
    if (rule === undefined) {
      throw new Error("Missing ScoutSeasonScheduleExpiring rule");
    }
    const expression = JSON.stringify(rule.expr);
    expect(rule.labels?.["severity"]).toBe("warning");
    expect(expression).toContain("scout_season_schedule_end_timestamp_seconds");
    expect(expression).toContain(String.raw`environment=\"prod\"`);
    expect(expression).toContain("1209600");
    expect(expression).toContain("259200");
  });

  test("pages below three days and after production metadata expires", () => {
    const rule = botHealth?.rules?.find(
      (candidate) => candidate.alert === "ScoutSeasonScheduleCritical",
    );
    if (rule === undefined) {
      throw new Error("Missing ScoutSeasonScheduleCritical rule");
    }
    const expression = JSON.stringify(rule.expr);
    expect(rule.labels?.["severity"]).toBe("critical");
    expect(expression).toContain("scout_season_schedule_end_timestamp_seconds");
    expect(expression).toContain(String.raw`environment=\"prod\"`);
    expect(expression).toContain("259200");
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
