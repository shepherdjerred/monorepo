import { mkdir } from "node:fs/promises";
import nodePath from "node:path";
import { parse } from "csv-parse/sync";
import { unzipSync } from "fflate";
import { z } from "zod/v4";
import {
  CorpusObservationSchema,
  SeedImportManifestSchema,
  type CorpusObservation,
  type SeedImportManifest,
} from "#shared/glitter-corpus.ts";
import {
  buildCurrentProjection,
  projectionChecksum,
  serializeProjection,
  sha256,
} from "#shared/glitter-corpus-projection.ts";
import { createCorpusStoresFromEnv } from "./glitter-corpus-store.ts";
import { putMirroredImmutableObject } from "./glitter-corpus-storage.ts";

const EXPECTED_SEED_MESSAGES = 76_762;
// Independent acceptance pins for the ONE trusted archive (see
// packages/docs/guides/2026-07-26_glitter-discord-corpus-operations.md). The
// row count alone is not identity: a truncated or substituted archive can
// preserve 76,762 unique IDs while changing message text, authors, timestamps,
// or IDs. Production (`--mirror=true`) imports must match both the archive
// bytes' SHA-256 and the deterministic projection SHA-256, so a different
// archive can never be mirrored under its own self-declared hash and become
// canonical.
const TRUSTED_SEED_ARCHIVE_SHA256 =
  "19aaca11be85b99d8034e48cfaf45e50e9739e9760da116d7262a6fd7588cc92";
const TRUSTED_SEED_PROJECTION_SHA256 =
  "8bad3bee568dfb5eb60d6524eee6b3c75d6ea3b1ac8f545887bac60cc8db572f";
const CsvRowsSchema = z.array(z.record(z.string(), z.string()));
const GuildMapSchema = z.record(z.string().min(1), z.string().regex(/^\d+$/));

type GuildMap = z.infer<typeof GuildMapSchema>;

export type SeedImportResult = {
  observations: CorpusObservation[];
  projectionNdjson: string;
  manifest: SeedImportManifest;
};

function requiredField(
  row: Readonly<Record<string, string>>,
  field: string,
  sourceKey: string,
): string {
  const value = row[field];
  if (value === undefined || value === "") {
    throw new Error(`seed row ${sourceKey} is missing required field ${field}`);
  }
  return value;
}

function optionalField(
  row: Readonly<Record<string, string>>,
  field: string,
): string | null {
  const value = row[field];
  return value === undefined || value === "" ? null : value;
}

function integerField(
  row: Readonly<Record<string, string>>,
  field: string,
  sourceKey: string,
  defaultValue?: number,
): number {
  const raw = row[field];
  if ((raw === undefined || raw === "") && defaultValue !== undefined) {
    return defaultValue;
  }
  if (raw === undefined || raw === "") {
    throw new Error(`seed row ${sourceKey} is missing integer field ${field}`);
  }
  const value = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(
      `seed row ${sourceKey} has invalid integer field ${field}: ${raw}`,
    );
  }
  return value;
}

function booleanField(
  row: Readonly<Record<string, string>>,
  field: string,
  sourceKey: string,
  defaultValue?: boolean,
): boolean {
  const raw = row[field];
  if ((raw === undefined || raw === "") && defaultValue !== undefined) {
    return defaultValue;
  }
  if (raw === "true") {
    return true;
  }
  if (raw === "false") {
    return false;
  }
  throw new Error(
    `seed row ${sourceKey} has invalid boolean field ${field}: ${raw ?? ""}`,
  );
}

function attachmentIndexes(row: Readonly<Record<string, string>>): number[] {
  const indexes = new Set<number>();
  for (const key of Object.keys(row)) {
    const match = /^attachments\.(\d+)\.id$/.exec(key);
    if (match?.[1] !== undefined && row[key] !== "") {
      indexes.add(Number.parseInt(match[1], 10));
    }
  }
  return [...indexes].toSorted((left, right) => left - right);
}

function seedAttachments(
  row: Readonly<Record<string, string>>,
  sourceKey: string,
) {
  return attachmentIndexes(row).map((index) => {
    const prefix = `attachments.${String(index)}`;
    const height = optionalField(row, `${prefix}.height`);
    const width = optionalField(row, `${prefix}.width`);
    return {
      id: requiredField(row, `${prefix}.id`, sourceKey),
      filename: requiredField(row, `${prefix}.filename`, sourceKey),
      size: integerField(row, `${prefix}.size`, sourceKey),
      url: requiredField(row, `${prefix}.url`, sourceKey),
      proxyUrl: requiredField(row, `${prefix}.proxy_url`, sourceKey),
      contentType: optionalField(row, `${prefix}.content_type`),
      height:
        height === null
          ? null
          : integerField(row, `${prefix}.height`, sourceKey),
      width:
        width === null ? null : integerField(row, `${prefix}.width`, sourceKey),
      description: optionalField(row, `${prefix}.description`),
      ephemeral: booleanField(row, `${prefix}.ephemeral`, sourceKey, false),
    };
  });
}

function normalizeSeedTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    throw new TypeError(`seed contains invalid timestamp: ${timestamp}`);
  }
  return date.toISOString();
}

function normalizeSeedRow(input: {
  row: Readonly<Record<string, string>>;
  guildSlug: string;
  guildId: string | null;
  archiveSha256: string;
  csvPath: string;
  rowNumber: number;
}): CorpusObservation {
  const sourceKey =
    `seed/${input.archiveSha256}/${input.csvPath}` +
    `#row=${String(input.rowNumber)}`;
  const timestamp = normalizeSeedTimestamp(
    requiredField(input.row, "timestamp", sourceKey),
  );
  const editedTimestamp = optionalField(input.row, "edited_timestamp");
  const globalName =
    optionalField(input.row, "author.global_name") ??
    optionalField(input.row, "author.display_name");
  return CorpusObservationSchema.parse({
    schemaVersion: 1,
    source: "seed",
    sourceKey,
    observedAt: timestamp,
    guildId: input.guildId,
    guildSlug: input.guildSlug,
    channelId: requiredField(input.row, "channel_id", sourceKey),
    messageId: requiredField(input.row, "id", sourceKey),
    author: {
      id: requiredField(input.row, "author.id", sourceKey),
      username: requiredField(input.row, "author.username", sourceKey),
      globalName,
      discriminator: input.row["author.discriminator"] ?? "0",
      bot: booleanField(input.row, "author.bot", sourceKey, false),
      avatar: optionalField(input.row, "author.avatar"),
    },
    content: input.row["content"] ?? "",
    timestamp,
    editedTimestamp:
      editedTimestamp === null ? null : normalizeSeedTimestamp(editedTimestamp),
    type: integerField(input.row, "type", sourceKey, 0),
    flags: input.row["flags"] ?? "0",
    pinned: booleanField(input.row, "pinned", sourceKey, false),
    tts: booleanField(input.row, "tts", sourceKey, false),
    attachments: seedAttachments(input.row, sourceKey),
    referencedMessageId: optionalField(
      input.row,
      "message_reference.message_id",
    ),
    raw: {
      csvPath: input.csvPath,
      rowNumber: input.rowNumber,
      rowSha256: sha256(JSON.stringify(input.row)),
    },
  });
}

function guildSlugForEntry(entryPath: string): string {
  const slash = entryPath.indexOf("/");
  if (slash <= 0) {
    throw new Error(`seed CSV is not nested under a guild slug: ${entryPath}`);
  }
  return entryPath.slice(0, slash);
}

export function importSeedArchive(input: {
  archiveBytes: Uint8Array;
  archivePath: string;
  importedAt?: string;
  guildMap?: GuildMap;
  expectedUniqueMessages?: number;
}): SeedImportResult {
  const archiveEntries = unzipSync(input.archiveBytes);
  const archiveSha256 = sha256(input.archiveBytes);
  const csvPaths = Object.keys(archiveEntries)
    .filter((path) => path.endsWith(".csv"))
    .toSorted();
  if (csvPaths.length === 0) {
    throw new Error("seed archive contains no CSV files");
  }

  const observations: CorpusObservation[] = [];
  for (const csvPath of csvPaths) {
    const bytes = archiveEntries[csvPath];
    if (bytes === undefined) {
      throw new Error(`seed archive entry disappeared: ${csvPath}`);
    }
    const rows = CsvRowsSchema.parse(
      parse(new TextDecoder().decode(bytes), {
        bom: true,
        columns: true,
        relax_column_count: true,
        skip_empty_lines: true,
      }),
    );
    const guildSlug = guildSlugForEntry(csvPath);
    const guildId = input.guildMap?.[guildSlug] ?? null;
    for (const [index, row] of rows.entries()) {
      observations.push(
        normalizeSeedRow({
          row,
          guildSlug,
          guildId,
          archiveSha256,
          csvPath,
          rowNumber: index + 2,
        }),
      );
    }
  }

  const projection = buildCurrentProjection(observations);
  const expected = input.expectedUniqueMessages ?? EXPECTED_SEED_MESSAGES;
  if (projection.length !== expected) {
    throw new Error(
      `seed acceptance failed: expected ${String(expected)} unique messages, imported ${String(projection.length)}`,
    );
  }

  const timestamps = observations
    .map((observation) => observation.timestamp)
    .toSorted();
  const firstTimestamp = timestamps[0];
  const lastTimestamp = timestamps.at(-1);
  if (firstTimestamp === undefined || lastTimestamp === undefined) {
    throw new Error("seed import produced no timestamps");
  }

  const projectionNdjson = serializeProjection(projection);
  const importedAt = input.importedAt ?? lastTimestamp;
  const manifest = SeedImportManifestSchema.parse({
    schemaVersion: 1,
    importedAt,
    archivePath: input.archivePath,
    archiveSha256,
    csvFileCount: csvPaths.length,
    observationCount: observations.length,
    uniqueMessageCount: projection.length,
    duplicateMessageCount: observations.length - projection.length,
    firstTimestamp,
    lastTimestamp,
    guildSlugs: [
      ...new Set(observations.map((observation) => observation.guildSlug)),
    ].toSorted(),
    channelIds: [
      ...new Set(observations.map((observation) => observation.channelId)),
    ].toSorted(),
    authorIds: [
      ...new Set(observations.map((observation) => observation.author.id)),
    ].toSorted(),
    projectionSha256: projectionChecksum(projection),
  });
  return { observations, projectionNdjson, manifest };
}

function parseArg(
  argv: readonly string[],
  name: string,
  required: boolean,
): string | undefined {
  const prefix = `--${name}=`;
  const value = argv
    .find((argument) => argument.startsWith(prefix))
    ?.slice(prefix.length);
  if (required && (value === undefined || value === "")) {
    throw new Error(`missing required argument --${name}=...`);
  }
  return value;
}

async function readGuildMap(path: string | undefined): Promise<GuildMap> {
  if (path === undefined) {
    return {};
  }
  return GuildMapSchema.parse(await Bun.file(path).json());
}

export async function runSeedImporter(argv: readonly string[]): Promise<void> {
  const archivePath = parseArg(argv, "archive", true);
  const outputDirectory = parseArg(argv, "output", true);
  if (archivePath === undefined || outputDirectory === undefined) {
    throw new Error("seed importer arguments unexpectedly missing");
  }
  const guildMapPath = parseArg(argv, "guild-map", false);
  const guildMap = await readGuildMap(guildMapPath);
  const archiveBytes = new Uint8Array(
    await Bun.file(archivePath).arrayBuffer(),
  );
  const explicitImportedAt = parseArg(argv, "imported-at", false);
  const result = importSeedArchive({
    archiveBytes,
    archivePath: nodePath.basename(archivePath),
    ...(explicitImportedAt === undefined
      ? {}
      : { importedAt: explicitImportedAt }),
    guildMap,
  });
  const importedAt = result.manifest.importedAt;
  await mkdir(outputDirectory, { recursive: true });
  await Bun.write(
    `${outputDirectory}/observations.ndjson`,
    `${result.observations
      .map((observation) => JSON.stringify(observation))
      .join("\n")}\n`,
  );
  await Bun.write(
    `${outputDirectory}/projection.ndjson`,
    result.projectionNdjson,
  );
  await Bun.write(
    `${outputDirectory}/manifest.json`,
    `${JSON.stringify(result.manifest, null, 2)}\n`,
  );
  const byChannel = new Map<string, CorpusObservation[]>();
  for (const observation of result.observations) {
    const channel = byChannel.get(observation.channelId);
    if (channel === undefined) {
      byChannel.set(observation.channelId, [observation]);
    } else {
      channel.push(observation);
    }
  }
  for (const [channelId, observations] of byChannel) {
    const channelDirectory = `${outputDirectory}/channels/${channelId}`;
    await mkdir(channelDirectory, { recursive: true });
    await Bun.write(
      `${channelDirectory}/observations.ndjson`,
      `${observations
        .map((observation) => JSON.stringify(observation))
        .join("\n")}\n`,
    );
  }

  if (parseArg(argv, "mirror", false) === "true") {
    if (result.manifest.archiveSha256 !== TRUSTED_SEED_ARCHIVE_SHA256) {
      throw new Error(
        `refusing to mirror untrusted seed: archive SHA-256 ${result.manifest.archiveSha256} does not match the pinned trusted archive ${TRUSTED_SEED_ARCHIVE_SHA256}`,
      );
    }
    if (result.manifest.projectionSha256 !== TRUSTED_SEED_PROJECTION_SHA256) {
      throw new Error(
        `refusing to mirror untrusted seed: projection SHA-256 ${result.manifest.projectionSha256} does not match the pinned trusted projection ${TRUSTED_SEED_PROJECTION_SHA256}`,
      );
    }
    const stores = createCorpusStoresFromEnv();
    const prefix = `seed/${result.manifest.archiveSha256}`;
    await putMirroredImmutableObject({
      stores,
      key: `${prefix}/archive.zip`,
      body: archiveBytes,
      contentType: "application/zip",
      writtenAt: importedAt,
    });
    await putMirroredImmutableObject({
      stores,
      key: `${prefix}/manifest.json`,
      body: new TextEncoder().encode(
        `${JSON.stringify(result.manifest, null, 2)}\n`,
      ),
      contentType: "application/json",
      writtenAt: importedAt,
    });
    await putMirroredImmutableObject({
      stores,
      key: `${prefix}/projection.ndjson`,
      body: new TextEncoder().encode(result.projectionNdjson),
      contentType: "application/x-ndjson",
      writtenAt: importedAt,
    });
    for (const [channelId, observations] of byChannel) {
      await putMirroredImmutableObject({
        stores,
        key: `${prefix}/channels/${channelId}/observations.ndjson`,
        body: new TextEncoder().encode(
          `${observations
            .map((observation) => JSON.stringify(observation))
            .join("\n")}\n`,
        ),
        contentType: "application/x-ndjson",
        writtenAt: importedAt,
      });
    }
    console.warn(`mirrored seed prefix: ${prefix}`);
  }
  console.warn(
    JSON.stringify(
      {
        archiveSha256: result.manifest.archiveSha256,
        csvFileCount: result.manifest.csvFileCount,
        observationCount: result.manifest.observationCount,
        uniqueMessageCount: result.manifest.uniqueMessageCount,
        duplicateMessageCount: result.manifest.duplicateMessageCount,
        firstTimestamp: result.manifest.firstTimestamp,
        lastTimestamp: result.manifest.lastTimestamp,
        guildSlugs: result.manifest.guildSlugs,
        channelCount: result.manifest.channelIds.length,
        authorCount: result.manifest.authorIds.length,
        projectionSha256: result.manifest.projectionSha256,
      },
      null,
      2,
    ),
  );
}
