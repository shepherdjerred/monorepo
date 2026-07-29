import type { BenchmarkRunSummaryEntry } from "./benchmark-harness.ts";

type BenchmarkRunExecutor = (run: number) => Promise<BenchmarkRunSummaryEntry>;

export async function runBenchmarkSeries(
  requestedRuns: number,
  executeRun: BenchmarkRunExecutor,
): Promise<readonly BenchmarkRunSummaryEntry[]> {
  const entries: BenchmarkRunSummaryEntry[] = [];
  for (let run = 1; run <= requestedRuns; run += 1) {
    const entry = await executeRun(run);
    entries.push(entry);
    if (entry.outcome === "invalid-provider") break;
  }
  return entries;
}
