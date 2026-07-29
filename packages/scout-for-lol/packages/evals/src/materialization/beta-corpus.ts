import { Database } from "bun:sqlite";
import {
  PlayerConfigEntrySchema,
  PlayerConfigSchema,
  type PlayerConfigEntry,
  type RawMatch,
} from "@scout-for-lol/data";
import { z } from "zod";

export const BetaProfileRowSchema = z.strictObject({
  accountId: z.number().int().positive(),
  alias: z.string().min(1),
  discordId: z.string().nullable(),
  playerId: z.number().int().positive(),
  puuid: z.string().min(1),
  region: z.string().min(1),
  serverId: z.string().min(1),
});

export type BetaProfileRow = z.infer<typeof BetaProfileRowSchema>;

export const BETA_CORPUS_BUCKET = "scout-beta";

export function defaultBetaCorpusPath(): string {
  return new URL("../../data/scout-beta-corpus.sqlite", import.meta.url)
    .pathname;
}

const SnapshotMetadataSchema = z.strictObject({
  sourceStage: z.literal("beta"),
  schemaVersion: z.literal("1"),
});

const StoredProfileSchema = BetaProfileRowSchema.omit({
  accountId: true,
  playerId: true,
});

const CREATE_METADATA_SQL = `
  CREATE TABLE metadata (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  ) STRICT
`;

const CREATE_PROFILES_SQL = `
  CREATE TABLE profiles (
    puuid TEXT PRIMARY KEY,
    alias TEXT NOT NULL,
    region TEXT NOT NULL,
    discord_id TEXT,
    server_id TEXT NOT NULL,
    source_player_id INTEGER NOT NULL,
    source_account_id INTEGER NOT NULL
  ) STRICT
`;

export function writeBetaCorpusSnapshot(
  path: string,
  profiles: BetaProfileRow[],
  sourcePod: string,
): void {
  const database = new Database(path, { create: true, strict: true });
  try {
    database.run(CREATE_METADATA_SQL);
    database.run(CREATE_PROFILES_SQL);
    const insertMetadata = database.query(
      "INSERT INTO metadata (key, value) VALUES (?, ?)",
    );
    insertMetadata.run("schemaVersion", "1");
    insertMetadata.run("sourceStage", "beta");
    insertMetadata.run("sourcePod", sourcePod);
    insertMetadata.run("syncedAt", new Date().toISOString());
    const insertProfile = database.query(
      `INSERT INTO profiles (
         puuid, alias, region, discord_id, server_id,
         source_player_id, source_account_id
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    database.transaction(() => {
      for (const profile of profiles) {
        insertProfile.run(
          profile.puuid,
          profile.alias,
          profile.region,
          profile.discordId,
          profile.serverId,
          profile.playerId,
          profile.accountId,
        );
      }
    })();
    z.strictObject({ integrityCheck: z.literal("ok") }).parse(
      database
        .query(
          "SELECT integrity_check AS integrityCheck FROM pragma_integrity_check",
        )
        .get(),
    );
  } finally {
    database.close();
  }
}

export class BetaCorpus {
  readonly #database: Database;

  public constructor(path: string) {
    this.#database = new Database(path, { readonly: true, strict: true });
    this.#database.run("PRAGMA query_only = ON");
    const metadataRows = z
      .array(z.strictObject({ key: z.string(), value: z.string() }))
      .parse(
        this.#database
          .query(
            "SELECT key, value FROM metadata WHERE key IN ('sourceStage', 'schemaVersion')",
          )
          .all(),
      );
    const metadata = Object.fromEntries(
      metadataRows.map((row) => [row.key, row.value]),
    );
    SnapshotMetadataSchema.parse(metadata);
  }

  public getProfile(puuid: string): PlayerConfigEntry | undefined {
    const row = this.#database
      .query(
        `SELECT
           puuid,
           alias,
           region,
           discord_id AS discordId,
           server_id AS serverId
         FROM profiles
         WHERE puuid = ?`,
      )
      .get(puuid);
    if (row === null) return undefined;
    const profile = StoredProfileSchema.parse(row);
    return PlayerConfigEntrySchema.parse({
      alias: profile.alias,
      discordAccount: {
        id: profile.discordId ?? undefined,
      },
      league: {
        leagueAccount: {
          puuid: profile.puuid,
          region: profile.region,
        },
      },
    });
  }

  public profilesForMatch(rawMatch: RawMatch): PlayerConfigEntry[] {
    const profiles: PlayerConfigEntry[] = [];
    for (const participant of rawMatch.info.participants) {
      const profile = this.getProfile(participant.puuid);
      if (profile !== undefined) profiles.push(profile);
    }
    return PlayerConfigSchema.parse(profiles);
  }

  public close(): void {
    this.#database.close();
  }
}
