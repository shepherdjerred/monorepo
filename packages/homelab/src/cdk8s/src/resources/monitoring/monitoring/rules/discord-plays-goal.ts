import type { PrometheusRuleSpecGroups } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { PrometheusRuleSpecGroupsRulesExpr } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { escapePrometheusTemplate } from "./shared.ts";

/**
 * Discord Plays Pokemon goal-agent alerts. The goal system runs a paid Codex process
 * against the live emulator with a hard max_runtime_minutes cap (30m), so both alerts
 * are "the harness lost control" signals rather than gameplay-quality ones.
 */
export function getDiscordPlaysGoalRuleGroups(): PrometheusRuleSpecGroups[] {
  return [
    {
      name: "discord-plays-goal.rules",
      interval: "1m",
      rules: [
        {
          alert: "PokemonGoalStuck",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            'max(pokemon_goal_runtime_seconds{namespace="arcade"}) >= 40 * 60',
          ),
          // Check an individual goal's age: overlapping bounded goals can keep
          // the aggregate active count nonzero indefinitely without being stuck.
          // Hard max_runtime_minutes cap is 30m; >= 40m means timeoutGoal -> claimActive
          // teardown failed or the Codex child process did not exit.
          labels: { severity: "warning", category: "discord-plays" },
          annotations: {
            summary: "Pokemon goal exceeded its hard runtime cap",
            description: escapePrometheusTemplate(
              "A Discord Plays Pokemon goal has run for {{ $value | humanizeDuration }} past the 30-minute hard cap, leaving a paid Codex session wedged against the emulator. Check the Arcade controller goal-manager logs and the pokemon.goal.run trace in Tempo.",
            ),
          },
        },
        {
          alert: "PokemonGoalStreamDownMidGoal",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            'max(pokemon_goal_stream_down{namespace="arcade"}) > 0',
          ),
          for: "3m",
          labels: { severity: "warning", category: "discord-plays" },
          annotations: {
            summary: "Pokemon goal is burning tokens with no live stream",
            description:
              "A Discord Plays Pokemon goal Codex session is running while the Go-Live broadcast is offline, spending model tokens with no live stream or voice-channel controls. Check the Stream Health dashboard and Arcade controller logs to restore the broadcast or terminate the orphaned goal.",
          },
        },
      ],
    },
  ];
}
