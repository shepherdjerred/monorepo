import { z } from "zod";
import {
  RawChampionMasterySchema,
  type LeaguePuuid,
} from "@scout-for-lol/data";
import { prisma } from "#src/database/index.ts";

const LocalMasteryRowSchema = RawChampionMasterySchema.extend({
  puuid: z.string().min(1).max(128),
  championSeasonMilestone: z.number().int().nonnegative().optional(),
  highestGrade: z.string().max(16).optional(),
  markRequiredForNextLevel: z.number().int().nonnegative().optional(),
  milestoneGrades: z.array(z.string().max(16)).max(32).optional(),
});

const LocalMasteryPayloadSchema = z.object({
  resource: z.literal("champion_mastery"),
  data: z.array(LocalMasteryRowSchema).max(500),
});

export type LocalMasteryRow = z.infer<typeof LocalMasteryRowSchema>;

export function parseLocalMasterySnapshot(
  payload: unknown,
  puuid: LeaguePuuid,
): readonly LocalMasteryRow[] | null {
  const parsed = LocalMasteryPayloadSchema.safeParse(payload);
  return !parsed.success || parsed.data.data.some((row) => row.puuid !== puuid)
    ? null
    : parsed.data.data;
}

export async function readLocalMasterySnapshot(puuid: LeaguePuuid): Promise<{
  readonly rows: readonly LocalMasteryRow[];
  readonly capturedAt: Date;
} | null> {
  const snapshot = await prisma.scoutClientPlayerSnapshot.findUnique({
    where: {
      localPuuid_resource: { localPuuid: puuid, resource: "champion_mastery" },
    },
    include: { observation: { select: { payload: true } } },
  });
  if (snapshot === null) return null;
  const rows = parseLocalMasterySnapshot(snapshot.observation.payload, puuid);
  return rows === null ? null : { rows, capturedAt: snapshot.capturedAt };
}
