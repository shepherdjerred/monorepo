import { createHash } from "node:crypto";
import path from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import { canonicalJson } from "#migration/profile-import.ts";
import {
  LEGACY_ACTIVITY_BATCH_SIZE,
  LegacyActivityEventSchema,
  LegacyActivityImportSchema,
  LegacyActivitySourceSchema,
  legacyActivityKey,
  type LegacyActivityEvent,
} from "#shared/legacy-activity/contract.ts";

const sha256 = z.hash("sha256");
const archiveBinding = z.object({ pvcUid: z.uuid() });
const ArchiveHeader = z.object({
  schemaVersion: z.literal(1),
  source: LegacyActivitySourceSchema,
  sourceBinding: archiveBinding,
  records: z.json(),
});
const ArchiveSchema = ArchiveHeader.extend({ eventDigestSha256: sha256 });
const OldArchiveSchema = ArchiveSchema.extend({ currentArchiveSha256: sha256 });
const ProviderSupplementSchema = ArchiveHeader.extend({
  parentArchiveSha256: sha256,
});
const LanguageSupplementSchema = ArchiveHeader.extend({
  originalArchiveSha256: sha256,
});
const recordIdentity = {
  id: z.int().positive(),
  date: z.string(),
};
const managerRow = z.object({
  ...recordIdentity,
  eventType: z.string(),
  eventCode: z.int().optional(),
  provider: z.string().nullable(),
  fileId: z.int().nullable(),
  qualityId: z.int().nullable(),
  sourceCustomFormatScore: z.int().nullable(),
});
const SonarrRow = managerRow.extend({
  seriesId: z.int().nullable(),
  episodeId: z.int().nullable(),
});
const RadarrRow = managerRow.extend({ movieId: z.int().nullable() });
const providerRow = z.object({
  ...recordIdentity,
  provider: z.string().nullable(),
});
const bazarrIdentity = { id: z.int().positive(), timestamp: z.string() };
const languageRow = z.object({
  ...bazarrIdentity,
  language: z.string().nullable(),
});
const bazarrRow = languageRow.partial({ language: true }).extend({
  action: z.int(),
  mediaId: z.int().nullable(),
  seriesId: z.int().nullable(),
  provider: z.string().nullable(),
  score: z.int().nullable(),
  scoreOutOf: z.int().nullable(),
  upgradedFromId: z.int().nullable(),
});
const sourceOrder = ["sonarr", "radarr", "bazarr"] as const;
type Source = (typeof sourceOrder)[number];

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function read(directory: string, name: string) {
  const bytes = await Bun.file(path.join(directory, name)).text();
  return { bytes, json: z.json().parse(JSON.parse(bytes)) };
}

function assertArchive(
  input: z.infer<typeof ArchiveSchema>,
  source: Source,
): void {
  if (
    input.source !== source ||
    digest(`${canonicalJson(input.records)}\n`) !== input.eventDigestSha256
  ) {
    throw new Error(`Activity digest or source differs for ${source}`);
  }
}

function assertSupplement(
  supplement: z.infer<typeof ArchiveHeader>,
  original: z.infer<typeof ArchiveHeader>,
  declaredParentDigest: string,
  parentBytes: string,
): void {
  if (
    supplement.source !== original.source ||
    supplement.sourceBinding.pvcUid !== original.sourceBinding.pvcUid ||
    declaredParentDigest !== digest(parentBytes)
  )
    throw new Error(
      `Activity supplement has a different origin for ${original.source}`,
    );
}

/** These captures' source clocks are UTC. Keep any fractional seconds for provenance. */
export function legacySourceDate(value: string): string {
  const iso = value.replace(" ", "T");
  return z.iso.datetime().parse(iso.endsWith("Z") ? iso : `${iso}Z`);
}

function addByOriginalIdentity<
  K extends "date" | "timestamp",
  A extends { id: number } & Record<K, string>,
>(
  rows: readonly ({ id: number } & Record<K, string>)[],
  additions: readonly A[],
  timestamp: K,
): Map<number, A> {
  const originalDates = new Map(rows.map((row) => [row.id, row[timestamp]]));
  const byId = new Map(
    additions.map((addition) => {
      if (addition[timestamp] !== originalDates.get(addition.id))
        throw new Error(
          "Activity supplement row lacks an exact original timestamp match",
        );
      return [addition.id, addition];
    }),
  );
  if (byId.size !== additions.length)
    throw new Error("Activity supplement has duplicate IDs");
  return byId;
}

function managerEvent(
  row: z.infer<typeof SonarrRow> | z.infer<typeof RadarrRow>,
  instance: string,
  provider: string | null,
): LegacyActivityEvent {
  const common = {
    sourceInstanceId: instance,
    table: "history",
    originalId: row.id,
    sourceDate: legacySourceDate(row.date),
    action: row.eventType,
    actionCode: row.eventCode ?? null,
    fileId: row.fileId,
    qualityId: row.qualityId,
    customFormatScore: row.sourceCustomFormatScore,
    provider,
  };
  return LegacyActivityEventSchema.parse(
    "movieId" in row
      ? { ...common, source: "radarr", movieId: row.movieId }
      : {
          ...common,
          source: "sonarr",
          seriesId: row.seriesId,
          episodeId: row.episodeId,
        },
  );
}

async function readManager(directory: string, source: "sonarr" | "radarr") {
  const { bytes, json } = await read(directory, `${source}-activity-v2.json`);
  const archive = ArchiveSchema.parse(json);
  assertArchive(archive, source);
  const row = source === "sonarr" ? SonarrRow : RadarrRow;
  const current = z
    .object({ events: z.array(row) })
    .parse(archive.records).events;
  const { json: providers } = await read(
    directory,
    `${source}-grab-providers.json`,
  );
  const supplement = ProviderSupplementSchema.parse(providers);
  assertSupplement(supplement, archive, supplement.parentArchiveSha256, bytes);
  const byId = addByOriginalIdentity(
    current.filter((event) => event.eventType === "grabbed"),
    z.array(providerRow).parse(supplement.records),
    "date",
  );
  const instance = archive.sourceBinding.pvcUid;
  const events = current.map((event) =>
    managerEvent(
      event,
      instance,
      byId.get(event.id)?.provider ?? event.provider,
    ),
  );
  if (source === "sonarr") {
    const { json: old } = await read(
      directory,
      "older-sonarr-activity-v2.json",
    );
    const older = OldArchiveSchema.parse(old);
    assertArchive(older, "sonarr");
    assertSupplement(older, archive, older.currentArchiveSha256, bytes);
    const olderRows = z
      .object({ events: z.array(z.object({ record: SonarrRow })) })
      .parse(older.records);
    events.push(
      ...olderRows.events.map(({ record }) =>
        managerEvent(record, instance, record.provider),
      ),
    );
  }
  return events;
}

function bazarrEvent(
  row: z.infer<typeof bazarrRow>,
  instance: string,
  table: "episode" | "movie",
  language: string | null,
): LegacyActivityEvent {
  return LegacyActivityEventSchema.parse({
    source: "bazarr",
    sourceInstanceId: instance,
    table,
    originalId: row.id,
    sourceDate: legacySourceDate(row.timestamp),
    action: row.action,
    mediaId: row.mediaId,
    seriesId: row.seriesId,
    provider: row.provider,
    language,
    score: row.score,
    scoreOutOf: row.scoreOutOf,
    upgradedFromId: row.upgradedFromId,
  });
}

async function readBazarr(directory: string) {
  const { bytes, json } = await read(directory, "bazarr-activity.json");
  const archive = ArchiveSchema.parse(json);
  assertArchive(archive, "bazarr");
  const current = z
    .object({
      episode: z.array(bazarrRow),
      movie: z.array(bazarrRow),
    })
    .parse(archive.records);
  const { json: languages } = await read(
    directory,
    "bazarr-language-supplement.json",
  );
  const supplement = LanguageSupplementSchema.parse(languages);
  assertSupplement(
    supplement,
    archive,
    supplement.originalArchiveSha256,
    bytes,
  );
  const extras = z
    .object({
      table_history: z.array(languageRow),
      table_history_movie: z.array(languageRow),
    })
    .parse(supplement.records);
  const { json: old } = await read(directory, "older-bazarr-activity.json");
  const older = OldArchiveSchema.parse(old);
  assertArchive(older, "bazarr");
  assertSupplement(older, archive, older.currentArchiveSha256, bytes);
  const historicRow = z.object({ record: bazarrRow });
  const olderRows = z
    .object({
      episode: z.array(historicRow),
      movie: z.array(historicRow),
    })
    .parse(older.records);
  return (["episode", "movie"] as const).flatMap((table) => {
    const supplementalRows =
      table === "episode" ? extras.table_history : extras.table_history_movie;
    const byId = addByOriginalIdentity(
      current[table],
      supplementalRows,
      "timestamp",
    );
    const instance = archive.sourceBinding.pvcUid;
    return [
      ...current[table].map((event) =>
        bazarrEvent(
          event,
          instance,
          table,
          byId.get(event.id)?.language ?? event.language ?? null,
        ),
      ),
      ...olderRows[table].map(({ record }) =>
        bazarrEvent(record, instance, table, record.language ?? null),
      ),
    ];
  });
}

async function prepare(directory: string) {
  const groups = await Promise.all(
    sourceOrder.map((source) =>
      source === "bazarr"
        ? readBazarr(directory)
        : readManager(directory, source),
    ),
  );
  const events = groups.flat();
  const { json } = await read(
    directory,
    "combined-current-and-older-manifest.json",
  );
  const manifest = z
    .object({ distinctArchivedEvents: z.int().positive() })
    .parse(json);
  if (
    events.length !== manifest.distinctArchivedEvents ||
    new Set(events.map((event) => legacyActivityKey(event))).size !==
      events.length
  ) {
    throw new Error(
      "Activity count or original IDs differ from the combined archive",
    );
  }
  return events;
}

if (import.meta.main) {
  try {
    const { values } = parseArgs({
      options: { directory: { type: "string" } },
    });
    const events = await prepare(z.string().min(1).parse(values.directory));
    let batches = 0;
    for (
      let index = 0;
      index < events.length;
      index += LEGACY_ACTIVITY_BATCH_SIZE
    ) {
      const body = LegacyActivityImportSchema.parse({
        kind: "legacy_activity",
        events: events.slice(index, index + LEGACY_ACTIVITY_BATCH_SIZE),
      });
      process.stdout.write(`${JSON.stringify(body)}\n`);
      batches++;
    }
    console.error(
      `Prepared ${String(events.length)} activity events in ${String(batches)} import batches.`,
    );
  } catch (error) {
    // Validation input can contain source data. Emit only the failing property path.
    const failure =
      error instanceof z.ZodError
        ? error.issues.map((issue) => issue.path.join(".")).join(", ")
        : "archive verification";
    console.error(
      `Activity preparation failed during ${failure}. Pass --directory with the verified private activity archive.`,
    );
    process.exitCode = 1;
  }
}
