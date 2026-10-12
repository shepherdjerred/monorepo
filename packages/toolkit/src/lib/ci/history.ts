import { z } from "zod";
import {
  getPipeline,
  woodpeckerJson,
  WoodpeckerSummarySchema,
  type WoodpeckerConfig,
  type WoodpeckerPipeline,
} from "#lib/woodpecker/ci.ts";

/** Deduplicate by pipeline number when new arrivals shift offset pagination. */
export async function pipelineHistory(
  config: WoodpeckerConfig,
  since: number,
  until: number,
  signal?: AbortSignal,
): Promise<WoodpeckerPipeline[]> {
  const summaries = new Map<number, z.infer<typeof WoodpeckerSummarySchema>>();
  let previousOldest = Infinity;
  for (let page = 1; ; page++) {
    const entries = z
      .array(WoodpeckerSummarySchema)
      .parse(
        await woodpeckerJson(
          `/api/repos/${String(config.repoId)}/pipelines?perPage=50&page=${String(page)}`,
          config,
          signal,
        ),
      );
    for (const entry of entries) {
      if (entry.created === undefined || entry.created <= 0)
        throw new Error(
          `Pipeline ${String(entry.number)} has no creation timestamp`,
        );
      if (entry.created >= since && entry.created <= until)
        summaries.set(entry.number, entry);
    }
    if (
      entries.length < 50 ||
      entries.every((entry) => (entry.created ?? 0) < since)
    )
      break;
    const oldest = Math.min(...entries.map((entry) => entry.number));
    if (oldest >= previousOldest)
      throw new Error("CI history pagination did not advance");
    previousOldest = oldest;
  }
  const pending = [...summaries.values()];
  const pipelines: WoodpeckerPipeline[] = [];
  // Bound API pressure independently of the number of events in the window.
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      for (
        let entry = pending.pop();
        entry !== undefined;
        entry = pending.pop()
      ) {
        const pipeline = await getPipeline(entry.number, config, signal);
        if (
          pipeline.commit !== entry.commit ||
          pipeline.created !== entry.created
        )
          throw new Error(
            `Pipeline ${String(entry.number)} changed identity during collection`,
          );
        pipelines.push(pipeline);
      }
    }),
  );
  return pipelines.toSorted((a, b) => b.number - a.number);
}
