#!/usr/bin/env bun
/**
 * Manual probe of YouTube Music search through the production adapter. It uses the real network, so
 * it never runs in CI or the image build: run it with `bun run ytmusic:probe` where the question
 * is whether YouTube answers from this address, for example from a streambot pod after a deploy.
 *
 * It prints counts, latencies and validation-drop counts only. The queries are fixed in this file
 * and nothing the provider returns (titles, ids, artwork) is printed.
 */
import { register } from "@shepherdjerred/streambot/observability/metrics-registry.ts";
import {
  MusicSearchError,
  type MusicSearchKind,
} from "@shepherdjerred/streambot/music/search-provider.ts";
import { YouTubeMusicProvider } from "@shepherdjerred/streambot/music/youtube-music.ts";

const QUERIES = ["get lucky", "khruangbin", "hotel california acoustic"];
const KINDS: readonly MusicSearchKind[] = ["song", "video", "album", "artist"];
const SUGGEST_PREFIXES = ["get lu", "khru", "daf"];
const REPEATS = 3;

type Sample = {
  readonly operation: string;
  readonly outcome: string;
  readonly ms: number;
  readonly count: number;
};

function percentile(values: readonly number[], fraction: number): number {
  const sorted = values.toSorted((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.floor(fraction * sorted.length),
  );
  return Math.round(sorted[index] ?? 0);
}

/** Items that failed strict validation, and upstream nodes the client could not read. */
async function droppedItems(): Promise<{ items: number; parser: number }> {
  const metrics = await register.getMetricsAsJSON();
  const values =
    metrics.find(
      (candidate) =>
        candidate.name === "streambot_music_provider_dropped_items_total",
    )?.values ?? [];
  const sum = (parser: boolean) =>
    values
      .filter((value) => (value.labels["operation"] === "parser") === parser)
      .reduce((total, value) => total + value.value, 0);
  return { items: sum(false), parser: sum(true) };
}

async function timed(
  operation: string,
  call: () => Promise<number>,
): Promise<Sample> {
  const started = performance.now();
  try {
    const count = await call();
    return {
      operation,
      outcome: count === 0 ? "empty" : "ok",
      ms: Math.round(performance.now() - started),
      count,
    };
  } catch (error) {
    // Only the typed failure category: a provider error message must not reach this output.
    return {
      operation,
      outcome: error instanceof MusicSearchError ? error.failure : "error",
      ms: Math.round(performance.now() - started),
      count: 0,
    };
  }
}

async function main(): Promise<void> {
  const provider = new YouTubeMusicProvider();
  const samples: Sample[] = [];
  const started = performance.now();
  for (let round = 0; round < REPEATS; round += 1) {
    for (const query of QUERIES) {
      for (const kind of KINDS) {
        // A fresh provider per round would hide the cache; vary the text slightly instead.
        const text = round === 0 ? query : `${query} ${"x".repeat(round)}`;
        samples.push(
          await timed("search_" + kind, async () => {
            const page = await provider.search(
              kind,
              text,
              AbortSignal.timeout(15_000),
            );
            return page.items.length;
          }),
        );
      }
    }
    for (const prefix of SUGGEST_PREFIXES) {
      samples.push(
        await timed("suggest", async () => {
          const result = await provider.suggestions(
            round === 0 ? prefix : prefix + "x".repeat(round),
            AbortSignal.timeout(5000),
          );
          return result.kind === "suggestions" ? result.items.length : 0;
        }),
      );
    }
  }
  const operations = [...new Set(samples.map((sample) => sample.operation))];
  console.log(
    "operation        calls ok empty failed  p50ms  p95ms  maxMs  items(min-max)",
  );
  for (const operation of operations) {
    const own = samples.filter((sample) => sample.operation === operation);
    const ok = own.filter((sample) => sample.outcome === "ok").length;
    const empty = own.filter((sample) => sample.outcome === "empty").length;
    const times = own.map((sample) => sample.ms);
    const counts = own.map((sample) => sample.count);
    console.log(
      [
        operation.padEnd(16),
        String(own.length).padStart(5),
        String(ok).padStart(2),
        String(empty).padStart(5),
        String(own.length - ok - empty).padStart(6),
        String(percentile(times, 0.5)).padStart(6),
        String(percentile(times, 0.95)).padStart(6),
        String(Math.max(...times)).padStart(6),
        `  ${String(Math.min(...counts))}-${String(Math.max(...counts))}`,
      ].join(" "),
    );
  }
  const failures = [
    ...new Set(
      samples
        .filter(
          (sample) => sample.outcome !== "ok" && sample.outcome !== "empty",
        )
        .map((sample) => sample.outcome),
    ),
  ];
  const dropped = await droppedItems();
  console.log(
    `total ${String(samples.length)} calls in ${String(Math.round(performance.now() - started))} ms; validation drops ${String(dropped.items)}; parser nodes skipped ${String(dropped.parser)}; failure kinds: ${failures.length === 0 ? "none" : failures.join(",")}`,
  );
  if (failures.length > 0) process.exitCode = 1;
}

await main();
