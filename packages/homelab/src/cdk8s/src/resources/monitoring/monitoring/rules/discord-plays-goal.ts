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
            "max(pokemon_goal_active) > 0",
          ),
          // max_runtime_minutes is capped at 30 in the config schema; a goal gauge held
          // past that plus slack means the timeout/teardown path failed to fire.
          for: "40m",
          labels: { severity: "warning", category: "discord-plays" },
          annotations: {
            summary:
              "Pokemon goal has been active longer than the hard runtime cap",
            description: escapePrometheusTemplate(
              "pokemon_goal_active has been non-zero for over 40 minutes, but max_runtime_minutes is capped at 30 — the timeout/teardown path (timeoutGoal → claimActive) failed, the gauge leaked, or the process is unkillable. Check the pokemon pod's goal-manager logs and the pokemon.goal.run trace in Tempo.",
            ),
          },
        },
        {
          alert: "PokemonGoalStreamDownMidGoal",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            'max(pokemon_goal_active) > 0 and on() max(stream_active{namespace="pokemon"}) == 0',
          ),
          for: "3m",
          labels: { severity: "warning", category: "discord-plays" },
          annotations: {
            summary: "Pokemon goal is burning tokens with no live stream",
            description: escapePrometheusTemplate(
              "A goal Codex process is active but the Go-Live broadcast is down, so the paid run has no audience and nobody can watch or stop it from the voice channel. Either the stream died mid-goal (check the Stream Health dashboard) or a goal outlived its session teardown.",
            ),
          },
        },
      ],
    },
  ];
}
