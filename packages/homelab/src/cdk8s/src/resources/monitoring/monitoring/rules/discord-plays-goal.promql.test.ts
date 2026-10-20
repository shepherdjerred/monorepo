import { expect, test } from "vitest";
import { getDiscordPlaysGoalRuleGroups } from "./discord-plays-goal.ts";
import { runPromtoolFixture } from "./platform/promtool-fixture.ts";

function series(metric: string, value: number, namespace = "arcade") {
  return {
    series: `${metric}{namespace="${namespace}"}`,
    values: `${String(value)}x5`,
  };
}

test("goal stream alerts ignore other live Arcade broadcasts", async () => {
  const alert = getDiscordPlaysGoalRuleGroups()
    .flatMap((group) => group.rules)
    .find((rule) => rule?.alert === "PokemonGoalStreamDownMidGoal");
  if (alert === undefined) throw new Error("Missing goal stream alert");
  expect(alert.for).toBe("3m");
  await runPromtoolFixture({
    evaluation_interval: "1m",
    tests: [
      {
        name: "another live game cannot mask a failed goal broadcast",
        input: [
          series("pokemon_goal_stream_down", 1),
          series("pokemon_goal_active", 1),
          series("stream_active", 1),
        ],
        expected: [{ labels: "{}", value: 1 }],
      },
      {
        name: "a healthy goal with another game does not alert",
        input: [
          series("pokemon_goal_stream_down", 0),
          series("pokemon_goal_active", 1),
          series("stream_active", 2),
        ],
        expected: [],
      },
      {
        name: "idle sessions do not alert",
        input: [series("pokemon_goal_stream_down", 0)],
        expected: [],
      },
      {
        name: "retired workload observations cannot trigger Arcade's alert",
        input: [
          series("pokemon_goal_stream_down", 0),
          series("pokemon_goal_stream_down", 1, "pokemon"),
        ],
        expected: [],
      },
    ].map(({ name, input, expected }) => ({
      name,
      interval: "1m",
      input_series: input,
      promql_expr_test: [
        { expr: alert.expr.value, eval_time: "5m", exp_samples: expected },
      ],
    })),
  });
});

test("stuck-goal alert checks an individual goal age instead of overlapping activity", async () => {
  const alert = getDiscordPlaysGoalRuleGroups()
    .flatMap((group) => group.rules)
    .find((rule) => rule?.alert === "PokemonGoalStuck");
  if (alert === undefined) throw new Error("Missing stuck-goal alert");
  expect(alert.for).toBeUndefined();
  await runPromtoolFixture({
    evaluation_interval: "1m",
    tests: [
      { age: 20 * 60, active: 2, expected: [] },
      { age: 40 * 60, active: 1, expected: [{ labels: "{}", value: 40 * 60 }] },
      { age: 0, active: 0, expected: [] },
    ].map(({ age, active, expected }) => ({
      interval: "1m",
      input_series: [
        {
          series: 'pokemon_goal_active{namespace="arcade"}',
          values: `${String(active)}x45`,
        },
        {
          series: 'pokemon_goal_runtime_seconds{namespace="arcade"}',
          values: `${String(age)}x45`,
        },
      ],
      promql_expr_test: [
        { expr: alert.expr.value, eval_time: "45m", exp_samples: expected },
      ],
    })),
  });
});
