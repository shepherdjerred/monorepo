import { isDeepStrictEqual } from "node:util";
import {
  ReplayPatchObservationSchema,
  ReplayRenderPackageAdmissionSchema,
} from "@scout-for-lol/domain/artifacts/replay-support.ts";
import { getReplayContainerLayout } from "@scout-for-lol/domain/artifacts/replay-transport.mjs";
import { prisma } from "#src/database/index.ts";
import {
  REPLAY_PATCH_OBSERVATION_MAX_AGE_MS,
  verifyReplayRenderPackage,
} from "#src/replays/support.ts";
import type { VerifiedReplayAdmission } from "./admission-input.ts";
import type { ScoutReplayStage } from "./scout-target.ts";

function requireFreshObservation(observedAt: Date, now: Date): void {
  const age = now.getTime() - observedAt.getTime();
  if (age < -60_000 || age >= REPLAY_PATCH_OBSERVATION_MAX_AGE_MS)
    throw new Error("Official replay patch observation is not current");
}

/** Create the row only after the caller has verified publication and admission. */
export async function admitVerifiedReplayPackage(
  {
    stage,
    platformId,
    verified,
  }: {
    stage: ScoutReplayStage;
    platformId: string;
    verified: VerifiedReplayAdmission;
  },
  db: Pick<typeof prisma, "$transaction"> = prisma,
): Promise<"admitted" | "already_admitted"> {
  getReplayContainerLayout(verified.gameBuild, verified.protocol);
  return await db.$transaction(
    async (tx) => {
      const [server] = await tx.$queryRaw<{ clusterName: string }[]>`
        SELECT current_setting('cluster_name') AS "clusterName"
      `;
      if (server?.clusterName !== `scout-${stage}-postgresql`)
        throw new Error(
          `Replay admission requires the Scout ${stage} database cluster`,
        );

      // An official refresh must commit either before this read or after this
      // admission. FOR SHARE permits concurrent admissions and blocks UPDATE.
      const [locked] = await tx.$queryRaw<
        {
          platformId: string;
          patch: string;
          gameBuild: string;
          sourceUrl: string;
          sourceSha256: string;
          observedAt: Date;
        }[]
      >`
      SELECT "platformId", "patch", "gameBuild", "sourceUrl", "sourceSha256", "observedAt"
      FROM "ReplayPatchObservation"
      WHERE "platformId" = ${platformId}
      FOR SHARE
    `;
      if (locked === undefined)
        throw new Error(
          "Official replay patch observation is missing for this platform",
        );
      const observation = ReplayPatchObservationSchema.parse({
        ...locked,
        observedAt: locked.observedAt.toISOString(),
      });
      if (observation.gameBuild !== verified.gameBuild)
        throw new Error(
          "Replay package is not the latest exact build for this platform",
        );

      const now = new Date();
      requireFreshObservation(locked.observedAt, now);
      const row = {
        ...verified,
        publishedSha256: verified.manifestSha256,
        publishedAt: now,
        admittedAt: now,
      };
      verifyReplayRenderPackage(row, row.gameBuild, row.protocol, now);
      const created = await tx.replayRenderPackage.createMany({
        data: row,
        skipDuplicates: true,
      });
      const persisted = await tx.replayRenderPackage.findUnique({
        where: {
          gameBuild_protocol: {
            gameBuild: row.gameBuild,
            protocol: row.protocol,
          },
        },
      });
      if (
        persisted?.manifestSha256 !== row.manifestSha256 ||
        persisted.manifestJson !== row.manifestJson ||
        persisted.manifestPath !== row.manifestPath ||
        !isDeepStrictEqual(
          ReplayRenderPackageAdmissionSchema.parse(persisted.admissionJson),
          ReplayRenderPackageAdmissionSchema.parse(row.admissionJson),
        )
      )
        throw new Error(
          "Replay build and protocol already have a different immutable admission",
        );

      const verifiedAt = new Date();
      requireFreshObservation(locked.observedAt, verifiedAt);
      verifyReplayRenderPackage(
        persisted,
        row.gameBuild,
        row.protocol,
        verifiedAt,
      );
      return created.count === 1 ? "admitted" : "already_admitted";
    },
    { isolationLevel: "ReadCommitted" },
  );
}
