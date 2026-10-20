import { expect, test } from "vitest";
import { z } from "zod";
import { createDiscordPlaysDashboard } from "./discord-plays-dashboard.ts";
import { runPromtoolFixture } from "@shepherdjerred/homelab/cdk8s/src/resources/monitoring/monitoring/rules/platform/promtool-fixture.ts";

const Panel = z.object({
  title: z.string(),
  targets: z.array(z.object({ expr: z.string() })).optional(),
});

function expression(title: string): string {
  const panels = z.array(Panel).parse(createDiscordPlaysDashboard().panels);
  const query = panels.find((panel) => panel.title === title)?.targets?.[0]
    ?.expr;
  if (query === undefined) throw new Error(`Missing dashboard query: ${title}`);
  return query;
}

function labels(runtime: string) {
  return `{namespace="arcade",runtime="${runtime}"}`;
}

function buckets(runtime: string, first: number) {
  return [
    {
      series: `emulator_frame_emulate_ms_bucket{namespace="arcade",runtime="${runtime}",le="1"}`,
      values: `0+${String(first)}x36`,
    },
    {
      series: `emulator_frame_emulate_ms_bucket{namespace="arcade",runtime="${runtime}",le="100"}`,
      values: "0+10x36",
    },
    {
      series: `emulator_frame_emulate_ms_bucket{namespace="arcade",runtime="${runtime}",le="+Inf"}`,
      values: "0+10x36",
    },
  ];
}

test("dashboard curves preserve runtime identity and exclude old aggregate series", async () => {
  await runPromtoolFixture({
    evaluation_interval: "10s",
    tests: [
      {
        interval: "10s",
        input_series: [
          {
            series: `emulator_ticks_total${labels("mk64")}`,
            values: "0+300x36",
          },
          {
            series: `emulator_ticks_total${labels("emerald")}`,
            values: "0+600x36",
          },
          {
            series: 'emulator_ticks_total{namespace="arcade"}',
            values: "0+9990x36",
          },
          { series: `stream_active${labels("mk64")}`, values: "0x36" },
          { series: `stream_active${labels("emerald")}`, values: "1x36" },
          { series: 'pokemon_goal_active{namespace="arcade"}', values: "0x36" },
          {
            series: 'pokemon_goal_active{namespace="pokemon"}',
            values: "9x36",
          },
          ...buckets("mk64", 10),
          ...buckets("emerald", 0),
        ],
        promql_expr_test: [
          {
            expr: expression("Goal active"),
            eval_time: "5m",
            exp_samples: [{ labels: "{}", value: 0 }],
          },
          {
            expr: expression("Runtime frame rate (frames/s)"),
            eval_time: "5m",
            exp_samples: [
              { labels: labels("mk64"), value: 300 / 10 },
              { labels: labels("emerald"), value: 600 / 10 },
            ],
          },
          {
            expr: expression("Broadcast active"),
            eval_time: "5m",
            exp_samples: [
              { labels: labels("mk64"), value: 0 },
              { labels: labels("emerald"), value: 1 },
            ],
          },
          {
            expr: expression("Emulate time p95 (ms/frame)"),
            eval_time: "5m",
            exp_samples: [
              { labels: labels("mk64"), value: 0.95 },
              { labels: labels("emerald"), value: 1 + 0.95 * (100 - 1) },
            ],
          },
        ],
      },
    ],
  });
  expect(expression("Event-loop lag (s) & process CPU")).not.toContain(
    "runtime",
  );
});
