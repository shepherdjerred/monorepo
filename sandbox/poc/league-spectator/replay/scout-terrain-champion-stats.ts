import type { z } from "zod";

const championStatsDecoderSliceSha256 =
  "e4725bce602c14f5999ec83fae12eec239337caf77bdd5efacfe1b6299dec2aa";
// CLASSIC's exact archived profile retains the native constructor default.
export const defaultChampionLevelCap = 18;

export function createChampionHealthTracksSchema(schema: typeof z) {
  return schema.array(
    schema.object({
      participantId: schema.number().int().nonnegative(),
      points: schema
        .array(
          schema
            .tuple([
              schema.number().nonnegative(),
              schema.number().nonnegative(),
              schema.number().positive(),
            ])
            .refine(([, current, max]) => current <= max),
        )
        .nonempty(),
    }),
  );
}

export function createChampionResourceTracksSchema(schema: typeof z) {
  const nonnegative = schema.number().nonnegative();
  return schema.array(
    schema.object({
      participantId: nonnegative.int(),
      gold: schema.array(schema.tuple([nonnegative, nonnegative])).nonempty(),
      resource: schema
        .array(
          schema
            .tuple([nonnegative, nonnegative, nonnegative])
            .refine(([, current, max]) => current <= max),
        )
        .nonempty(),
    }),
  );
}

function createChampionExperienceTracksSchema(schema: typeof z) {
  const nonnegative = schema.number().nonnegative();
  return schema.array(
    schema.object({
      participantId: nonnegative.int(),
      levelCaps: schema.array(
        schema.tuple([nonnegative, schema.number().int().positive().max(255)]),
      ),
      points: schema
        .array(
          schema.tuple([
            nonnegative,
            nonnegative,
            schema.number().int().positive(),
          ]),
        )
        .nonempty(),
    }),
  );
}

export function championExperienceSceneSchema(schema: typeof z) {
  return schema.object({
    thresholds: schema
      .array(schema.number().positive())
      .min(defaultChampionLevelCap - 1)
      .refine((thresholds) =>
        thresholds.every((xp, index) => xp > (thresholds[index - 1] ?? 0)),
      ),
    tracks: createChampionExperienceTracksSchema(schema),
  });
}

export function readChampionTracks<T extends { participantId: number }>(
  tracks: readonly T[],
  roster: Iterable<number>,
  durationMilliseconds: number,
  timelines: (
    track: T,
  ) => readonly (readonly (readonly [number, ...unknown[]])[])[],
) {
  const missing = new Set(roster);
  const indexed = new Map<number, T>();
  const durationSeconds = durationMilliseconds / 1000;
  for (const track of tracks) {
    const { participantId } = track;
    if (
      !missing.delete(participantId) ||
      timelines(track).some((points) =>
        points.some(
          ([timeSeconds], index) =>
            timeSeconds > durationSeconds ||
            timeSeconds <= (points[index - 1]?.[0] ?? -1),
        ),
      )
    ) {
      throw new Error(
        "Recorded champion stats disagree with the roster or clock.",
      );
    }
    indexed.set(participantId, track);
  }
  if (missing.size > 0) {
    throw new Error("Recorded champion stats must cover the complete roster.");
  }
  return indexed;
}

export function readChampionHealthTracks(
  tracks: z.infer<ReturnType<typeof createChampionHealthTracksSchema>>,
  roster: Iterable<number>,
  durationMilliseconds: number,
) {
  return readChampionTracks(
    tracks,
    roster,
    durationMilliseconds,
    ({ points }) => [points],
  );
}

export function readChampionResourceTracks(
  tracks: z.infer<ReturnType<typeof createChampionResourceTracksSchema>>,
  roster: Iterable<number>,
  durationMilliseconds: number,
) {
  return readChampionTracks(
    tracks,
    roster,
    durationMilliseconds,
    ({ gold, resource }) => [gold, resource],
  );
}

export function readChampionExperienceTracks(
  {
    thresholds,
    tracks,
  }: z.infer<ReturnType<typeof championExperienceSceneSchema>>,
  roster: Iterable<number>,
  durationMilliseconds: number,
) {
  const indexed = readChampionTracks(
    tracks,
    roster,
    durationMilliseconds,
    ({ points, levelCaps }) => [points, levelCaps],
  );
  for (const { points, levelCaps } of indexed.values()) {
    if (levelCaps.some(([, cap]) => cap > thresholds.length + 1)) {
      throw new Error("Recorded champion level cap exceeds the mode curve.");
    }
    if (
      points.some(([time, experience, level]) => {
        const cap = effectiveChampionLevelCap(
          levelCaps.findLast(([start]) => start <= time)?.[1],
        );
        const previous = thresholds[Math.min(level, cap) - 2] ?? 0;
        const next = thresholds[level - 1];
        return (
          experience < previous ||
          (level < cap && next !== undefined && experience >= next)
        );
      })
    ) {
      throw new Error(
        "Recorded champion experience disagrees with the mode curve.",
      );
    }
  }
  return indexed;
}

export function effectiveChampionLevelCap(override: number | undefined) {
  return override ?? defaultChampionLevelCap;
}

export function admitRecordedChampionStats(
  schema: typeof z,
  artifact: unknown,
  identity: {
    build: string;
    protocol: string;
    replaySha256: string;
    durationMilliseconds: number;
  },
  roster: Iterable<number>,
  kind: "health" | "resources" | "experience",
) {
  const { tracks } = schema
    .object({
      kind: schema.literal(`scout-recorded-champion-${kind}`),
      build: schema.literal(identity.build),
      protocol: schema.literal(identity.protocol),
      replaySha256: schema.literal(identity.replaySha256),
      sliceSha256: schema.literal(championStatsDecoderSliceSha256),
      tracks: schema.unknown(),
    })
    .parse(artifact);
  if (kind === "health") {
    const health = createChampionHealthTracksSchema(schema).parse(tracks);
    readChampionHealthTracks(health, roster, identity.durationMilliseconds);
    return health;
  }
  if (kind === "experience")
    return createChampionExperienceTracksSchema(schema).parse(tracks);
  const resources = createChampionResourceTracksSchema(schema).parse(tracks);
  readChampionResourceTracks(resources, roster, identity.durationMilliseconds);
  return resources;
}
