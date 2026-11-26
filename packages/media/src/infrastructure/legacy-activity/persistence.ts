import { isDeepStrictEqual } from "node:util";
import type { MediaActor } from "#application/auth.ts";
import { MediaError, requireOwner } from "#application/errors.ts";
import {
  LEGACY_ACTIVITY_PAGE_SIZE,
  LEGACY_ACTIVITY_EVENT_KIND,
  LegacyActivityEventSchema,
  type LegacyActivityImport,
  type LegacyActivityPage,
  type LegacyActivityQuery,
  legacyActivityKey,
} from "#shared/legacy-activity/contract.ts";
import type { Database } from "#infrastructure/database.ts";
import { lockCommandActor } from "#infrastructure/editions/command-actor.ts";
import { repeatableRead } from "#infrastructure/locks.ts";
import { sonarrActivityLinks } from "./sonarr.ts";

function conflict() {
  return new MediaError(
    "legacy_activity_conflict",
    "An imported activity ID has different recorded facts",
    409,
  );
}

export async function importLegacyActivity(
  db: Database,
  actor: MediaActor,
  input: LegacyActivityImport,
) {
  requireOwner(actor);
  const events = new Map(
    input.events.map((event) => [legacyActivityKey(event), event]),
  );
  if (events.size !== input.events.length) throw conflict();

  return await db.$transaction(async (tx) => {
    requireOwner(await lockCommandActor(tx, actor));
    const links = await sonarrActivityLinks(tx, input.events);
    // Insert identical key sets in a consistent order across concurrent imports.
    const records = input.events
      .map((event) => ({
        dedupeKey: legacyActivityKey(event),
        mediaId: links.get(legacyActivityKey(event)) ?? null,
        kind: LEGACY_ACTIVITY_EVENT_KIND,
        createdAt: new Date(event.sourceDate),
        payload: event,
      }))
      .sort((left, right) => left.dedupeKey.localeCompare(right.dedupeKey));
    const keys = records.map((record) => record.dedupeKey);
    const inserted = await tx.applicationEvent.createMany({
      data: records,
      skipDuplicates: true,
    });
    const stored = await tx.applicationEvent.findMany({
      where: { dedupeKey: { in: keys }, kind: LEGACY_ACTIVITY_EVENT_KIND },
      select: { dedupeKey: true, payload: true },
    });
    if (
      stored.length !== keys.length ||
      stored.some(
        (row) =>
          row.dedupeKey === null ||
          !isDeepStrictEqual(row.payload, events.get(row.dedupeKey)),
      )
    )
      throw conflict();
    return {
      imported: inserted.count,
      unchanged: keys.length - inserted.count,
    };
  });
}

export async function readLegacyActivity(
  db: Database,
  actor: MediaActor,
  query: LegacyActivityQuery,
): Promise<LegacyActivityPage> {
  requireOwner(actor);
  return await repeatableRead(db, async (tx) => {
    requireOwner(await lockCommandActor(tx, actor));
    const where = {
      kind: LEGACY_ACTIVITY_EVENT_KIND,
      ...(query.source === "imported"
        ? {}
        : { payload: { path: ["source"], equals: query.source } }),
    };
    const before =
      query.before === undefined
        ? null
        : await tx.applicationEvent.findFirst({
            where: { ...where, id: query.before },
            select: { id: true, createdAt: true },
          });
    if (before === null && query.before !== undefined) {
      throw new MediaError(
        "invalid_input",
        "Activity page has expired. Start again from the latest activity.",
      );
    }
    const rows = await tx.applicationEvent.findMany({
      where: {
        ...where,
        ...(before === null
          ? {}
          : {
              OR: [
                { createdAt: { lt: before.createdAt } },
                { createdAt: before.createdAt, id: { lt: before.id } },
              ],
            }),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: LEGACY_ACTIVITY_PAGE_SIZE + 1,
      select: { id: true, payload: true, mediaId: true },
    });
    const visible = rows.slice(0, LEGACY_ACTIVITY_PAGE_SIZE);
    const ids = [
      ...new Set(
        visible.flatMap((row) => (row.mediaId === null ? [] : [row.mediaId])),
      ),
    ];
    const titles =
      ids.length === 0
        ? []
        : await tx.mediaItem.findMany({
            where: { id: { in: ids } },
            select: { id: true, title: true },
          });
    const byId = new Map(titles.map((title) => [title.id, title]));
    const items = visible.map((row) => {
      const media = row.mediaId === null ? undefined : byId.get(row.mediaId);
      return {
        id: row.id,
        event: LegacyActivityEventSchema.parse(row.payload),
        ...(media === undefined ? {} : { media }),
      };
    });
    return {
      items,
      nextCursor:
        rows.length > LEGACY_ACTIVITY_PAGE_SIZE
          ? (items.at(-1)?.id ?? null)
          : null,
    };
  });
}
