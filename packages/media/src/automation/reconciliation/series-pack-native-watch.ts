import { z } from "zod";
import { Prisma } from "#generated/prisma/client.ts";
import type { MediaAutomationContext } from "#automation/context.ts";
import { NativeArchiveScopeProtection } from "#infrastructure/native-archive/errors.ts";
import {
  observeRequesterWatch,
  queueRetentionCheck,
} from "#automation/watch.ts";

export const SERIES_PACK_NATIVE_TV_WATCH_CURSOR =
  "series-pack-native-tv-watch-v1:";

/** Current bounded scheduling projection only. These scalar candidates never
 * grant watch authority; the actual observer resolves the whole immutable new
 * receipt and the COMPLETE requester/physical cohort using the caller100. */
async function targets(context: MediaAutomationContext, cursor: string | null) {
  const rows = await context.db.$queryRaw<
    {
      mediaId: string;
      generation: number;
      automationEpoch: number;
    }[]
  >(Prisma.sql`SELECT i."mediaId",i.generation,i."automationEpoch" FROM "MediaIntent" i JOIN "MediaItem" m ON m.id=i."mediaId"
    WHERE i.edition='default' AND m.kind='episode' AND i.availability IN ('available','quarantined')
      ${cursor === null ? Prisma.empty : Prisma.sql`AND i."mediaId">${cursor}`}
      AND EXISTS(SELECT 1 FROM "NativePublicationCompensationContinuation" c
        WHERE c.descriptor->>'schemaVersion'='2' AND c.descriptor->>'protocol'='series_pack_publication_v3'
          AND c.state='compensated' AND c."recoveryEpoch"=i."automationEpoch"
          AND c."mediaIds" @> ARRAY[i."mediaId"]::text[] AND c.completion IS NOT NULL
          AND c."verifiedPublication" IS NOT NULL AND c."fenceRelease" IS NOT NULL)
    ORDER BY i."mediaId" LIMIT 2`);
  return z
    .array(
      z.strictObject({
        mediaId: z.uuid(),
        generation: z.int().nonnegative(),
        automationEpoch: z.int().nonnegative(),
      }),
    )
    .max(2)
    .parse(rows);
}

export async function hasSeriesPackNativeTvWatchTargetsV1(
  context: MediaAutomationContext,
) {
  const page = await targets(context, null);
  return page.length > 0;
}

/** Keep the historical50-row scan/order/cursor literal. New recovered targets
 * defer to their separately bounded semantic Activity instead of consuming a
 * fresh allowance for each target inside the old page. */
export async function seriesPackNativeTvWatchDeferralsV1(
  context: MediaAutomationContext,
  mediaIds: readonly string[],
) {
  if (mediaIds.length === 0) return new Set<string>();
  if (mediaIds.length > 50)
    throw new Error(
      "Historical watch deferral candidate page exceeds its original bound",
    );
  const rows = await context.db.$queryRaw<{ mediaId: string }[]>(Prisma.sql`
    SELECT DISTINCT i."mediaId" FROM "MediaIntent" i JOIN "MediaItem" m ON m.id=i."mediaId"
    WHERE i.edition='default' AND m.kind='episode' AND i."mediaId" IN (${Prisma.join(mediaIds)})
      AND EXISTS(SELECT 1 FROM "NativePublicationCompensationContinuation" c
        WHERE c.descriptor->>'schemaVersion'='2' AND c.descriptor->>'protocol'='series_pack_publication_v3'
          AND c."mediaIds" @> ARRAY[i."mediaId"]::text[] AND c."recoveryEpoch"=i."automationEpoch"
          AND c.completion IS NOT NULL AND c."verifiedPublication" IS NOT NULL AND c."fenceRelease" IS NOT NULL)
    ORDER BY i."mediaId" LIMIT 51`);
  if (rows.length > 50)
    throw new Error(
      "Current native TV deferral expanded its selected historical page",
    );
  return new Set(
    z
      .array(z.strictObject({ mediaId: z.uuid() }))
      .parse(rows)
      .map((row) => row.mediaId),
  );
}

/** One COMPLETE target/cohort per real Activity; two operational rows provide
 * truthful cursor lookahead. Oversized whole authority protects and advances
 * one candidate without another parent traversal or a second allowance. */
export async function sweepSeriesPackNativeTvWatchV1(
  context: MediaAutomationContext,
  rawCursor: string,
) {
  const invocation = context.movieManagement;
  if (invocation === undefined)
    throw new Error(
      "Native TV watch requires its original pre-lazy Activity allowance",
    );
  invocation.execution.assertActive();
  if (!rawCursor.startsWith(SERIES_PACK_NATIVE_TV_WATCH_CURSOR))
    throw new Error("Native TV watch cursor protocol changed");
  const value = rawCursor.slice(SERIES_PACK_NATIVE_TV_WATCH_CURSOR.length);
  const cursor = value === "start" ? null : z.uuid().parse(value);
  const page = await targets(context, cursor);
  invocation.execution.assertActive();
  const target = page[0];
  if (target !== undefined) {
    const bucket = String(
      Math.floor(invocation.execution.observed.wall / 300_000),
    );
    try {
      await observeRequesterWatch(context, target.mediaId);
      await queueRetentionCheck(context, target.mediaId, bucket);
    } catch (error) {
      if (!(error instanceof NativeArchiveScopeProtection)) throw error;
      invocation.execution.assertActive();
      const key = `series-pack-native-watch-protected:${target.mediaId}:${String(target.generation)}:${String(target.automationEpoch)}:${bucket}`;
      // Informational application audit only; the client humanizes all such
      // kinds. It creates no notification, action, consent or grant authority.
      await context.db.applicationEvent.upsert({
        where: { dedupeKey: key },
        update: {},
        create: {
          dedupeKey: key,
          kind: "series_pack_native_watch_protected",
          mediaId: target.mediaId,
          payload: {
            schemaVersion: 1,
            mediaId: target.mediaId,
            edition: "default",
            generation: target.generation,
            recoveryEpoch: target.automationEpoch,
            reason: error.code,
          },
        },
      });
    }
  }
  invocation.execution.assertActive();
  return {
    processed: target === undefined ? 0 : 1,
    nextCursor:
      target !== undefined && page.length === 2
        ? `${SERIES_PACK_NATIVE_TV_WATCH_CURSOR}${target.mediaId}`
        : null,
  };
}
