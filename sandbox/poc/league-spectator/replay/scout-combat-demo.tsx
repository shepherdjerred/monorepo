import { createRoot } from "react-dom/client";
import { useEffect, useState } from "react";
import { z } from "zod";
import { ScoutThemeProvider } from "@scout-for-lol/design-system/runtime";
import { ReplayResearchCombatAnalysis } from "../../../../packages/scout-for-lol/packages/app/src/components/replay/replay-analysis.tsx";

const KdaTimelineSchema = z
  .strictObject({
    actors: z
      .array(
        z.strictObject({
          partition: z.union([z.literal(0), z.literal(1)]),
          champion: z.string().nullable(),
        }),
      )
      .length(10),
    checkpoints: z
      .array(
        z.strictObject({
          timestampMs: z.number().int().nonnegative(),
          kda: z
            .array(
              z
                .strictObject({
                  kills: z.number().int().nonnegative(),
                  deaths: z.number().int().nonnegative(),
                  assists: z.number().int().nonnegative(),
                })
                .nullable(),
            )
            .length(10),
        }),
      )
      .min(1),
  })
  .superRefine((timeline, context) => {
    if (
      timeline.actors.some(
        (actor, index) => actor.partition !== (index < 5 ? 0 : 1),
      ) ||
      timeline.checkpoints[0]?.timestampMs !== 0 ||
      timeline.checkpoints.some((checkpoint) =>
        checkpoint.kda.some(
          (kda, index) =>
            (kda === null) !== (timeline.actors[index]?.champion === null),
        ),
      ) ||
      timeline.checkpoints.some(
        (checkpoint, index) =>
          index > 0 &&
          checkpoint.timestampMs <=
            (timeline.checkpoints[index - 1]?.timestampMs ?? 0),
      )
    )
      context.addIssue({
        code: "custom",
        message:
          "Stable actor slots and strictly ordered K/D/A checkpoints required",
      });
  });

const CombatResultSchema = z.strictObject({
  build: z.enum(["16.23.839.9929", "16.23.840.6595"]),
  duration: z.number().positive(),
  kdaTimeline: KdaTimelineSchema,
  turrets: z
    .array(
      z.strictObject({
        timeSeconds: z.number().nonnegative(),
        defendingPartition: z.union([z.literal(0), z.literal(1)]).nullable(),
      }),
    )
    .nullable(),
  inhibitors: z
    .array(z.strictObject({ timeSeconds: z.number().nonnegative() }))
    .nullable(),
  aliveCounts: z
    .array(
      z.strictObject({
        timestampMs: z.number().int().nonnegative(),
        teamA: z.number().int().min(0).max(5),
        teamB: z.number().int().min(0).max(5),
      }),
    )
    .nullable(),
  events: z.array(
    z.strictObject({
      kind: z.enum(["champion-kill", "champion-death"]),
      partition: z.union([z.literal(0), z.literal(1)]),
      timeSeconds: z.number().nonnegative(),
      champion: z.string().nullable(),
    }),
  ),
  levels: z.array(
    z.strictObject({
      partition: z.union([z.literal(0), z.literal(1)]).nullable(),
      timeSeconds: z.number().nonnegative(),
      champion: z.string().nullable(),
      level: z.number().int().min(2).max(18),
    }),
  ),
  returns: z
    .array(
      z.strictObject({
        partition: z.union([z.literal(0), z.literal(1)]),
        timeSeconds: z.number().nonnegative(),
        champion: z.string().nullable(),
      }),
    )
    .nullable(),
});

function timelineEvents(replay: z.infer<typeof CombatResultSchema>) {
  return [
    ...replay.events.map(({ kind, ...event }) => ({
      ...event,
      type:
        kind === "champion-kill"
          ? ("CHAMPION_KILL" as const)
          : ("CHAMPION_DEATH" as const),
    })),
    ...replay.levels.map((event) => ({
      ...event,
      type: "ACTOR_LEVEL" as const,
    })),
    ...(replay.returns ?? []).map((event) => ({
      ...event,
      type: "CHAMPION_RETURN" as const,
    })),
    ...(replay.turrets ?? []).map((event) => ({
      ...event,
      type: "TURRET_DESTRUCTION" as const,
      partition: null,
      champion: null,
    })),
    ...(replay.inhibitors ?? []).map((event) => ({
      ...event,
      type: "INHIBITOR_DESTRUCTION" as const,
      partition: null,
      champion: null,
    })),
  ]
    .sort((left, right) => left.timeSeconds - right.timeSeconds)
    .map(({ timeSeconds, ...event }, id) => ({
      ...event,
      id,
      timestampMs: Math.ceil(timeSeconds * 1000),
    }));
}

function ScoutResearchCombatDemo() {
  const [replay, setReplay] = useState<z.infer<
    typeof CombatResultSchema
  > | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    const worker = new Worker("/research/combat-timeline-worker.mjs?levels", {
      type: "module",
    });
    worker.addEventListener("error", () => {
      setError(true);
      worker.terminate();
    });
    worker.addEventListener("message", ({ data }: MessageEvent<unknown>) => {
      const result = CombatResultSchema.safeParse(data);
      if (result.success) setReplay(result.data);
      else setError(true);
      worker.terminate();
    });
    return () => worker.terminate();
  }, []);
  return (
    <ScoutThemeProvider surface="app">
      <main className="mx-auto max-w-4xl space-y-4 p-4 sm:p-8">
        <header className="space-y-1">
          <h1 className="text-3xl font-semibold">Local replay research</h1>
          {replay !== null && (
            <p className="text-sm text-scout-subtle">
              Build {replay.build} · {replay.events.length} combat events ·{" "}
              {replay.levels.length} level ups
              {replay.returns !== null &&
                ` · ${replay.returns.length.toString()} returns`}
              {replay.turrets !== null &&
                ` · ${replay.turrets.length.toString()} turret destructions`}
              {replay.inhibitors !== null &&
                ` · ${replay.inhibitors.length.toString()} inhibitor destructions`}
            </p>
          )}
        </header>
        {error ? (
          <p role="alert">
            Scout could not decode the research timeline from this replay.
          </p>
        ) : replay === null ? (
          <p role="status">Reading the local replay timeline…</p>
        ) : (
          <ReplayResearchCombatAnalysis
            kdaTimeline={replay.kdaTimeline}
            events={timelineEvents(replay)}
            returnsAvailable={replay.returns !== null}
            aliveCounts={replay.aliveCounts}
            turretsAvailable={replay.turrets !== null}
            inhibitorsAvailable={replay.inhibitors !== null}
            durationSeconds={replay.duration}
            search={location.search}
          />
        )}
      </main>
    </ScoutThemeProvider>
  );
}

const container = document.getElementById("root");
if (container === null) throw new Error("Scout replay demo root is missing");
createRoot(container).render(<ScoutResearchCombatDemo />);
