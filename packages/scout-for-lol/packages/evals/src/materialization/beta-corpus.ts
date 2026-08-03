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
  schemaVersion: z.literal("2"),
});

const TrackedProfileSchema = z.strictObject({
  playerId: z.number().int().positive(),
  profile: PlayerConfigEntrySchema,
});

export type TrackedProfile = z.infer<typeof TrackedProfileSchema>;

const CREATE_METADATA_SQL = `
  CREATE TABLE metadata (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  ) STRICT
`;

const CREATE_PROFILES_SQL = `
  CREATE TABLE profiles (
    puuid TEXT NOT NULL,
    alias TEXT NOT NULL,
    region TEXT NOT NULL,
    discord_id TEXT,
    server_id TEXT NOT NULL,
    source_player_id INTEGER NOT NULL,
    source_account_id INTEGER NOT NULL UNIQUE,
    PRIMARY KEY (server_id, puuid)
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
    insertMetadata.run("schemaVersion", "2");
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

  #parseProfile(row: unknown): BetaProfileRow | undefined {
    if (row === null) return undefined;
    return BetaProfileRowSchema.parse(row);
  }

  #profileForServer(
    serverId: string,
    puuid: string,
  ): BetaProfileRow | undefined {
    return this.#parseProfile(
      this.#database
        .query(
          `SELECT
             source_account_id AS accountId,
             alias,
             discord_id AS discordId,
             source_player_id AS playerId,
             puuid,
             region,
             server_id AS serverId
           FROM profiles
           WHERE server_id = ? AND puuid = ?`,
        )
        .get(serverId, puuid),
    );
  }

  #toPlayerConfig(profile: BetaProfileRow): PlayerConfigEntry {
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

  public getProfile(
    playerId: number,
    puuid: string,
  ): PlayerConfigEntry | undefined {
    const row = this.#database
      .query(
        `SELECT
           source_account_id AS accountId,
           alias,
           discord_id AS discordId,
           source_player_id AS playerId,
           puuid,
           region,
           server_id AS serverId
         FROM profiles
         WHERE source_player_id = ? AND puuid = ?`,
      )
      .get(playerId, puuid);
    const profile = this.#parseProfile(row);
    return profile === undefined ? undefined : this.#toPlayerConfig(profile);
  }

  public trackedProfilesForMatch(rawMatch: RawMatch): TrackedProfile[] {
    const trackedProfiles: TrackedProfile[] = [];
    for (const participant of rawMatch.info.participants) {
      const rows = this.#database
        .query(
          `SELECT
             source_account_id AS accountId,
             alias,
             discord_id AS discordId,
             source_player_id AS playerId,
             puuid,
             region,
             server_id AS serverId
           FROM profiles
           WHERE puuid = ?
           ORDER BY server_id, source_player_id`,
        )
        .all(participant.puuid);
      for (const row of z.array(BetaProfileRowSchema).parse(rows)) {
        trackedProfiles.push(
          TrackedProfileSchema.parse({
            playerId: row.playerId,
            profile: this.#toPlayerConfig(row),
          }),
        );
      }
    }
    return z.array(TrackedProfileSchema).parse(trackedProfiles);
  }

  public profilesForMatch(
    rawMatch: RawMatch,
    targetPlayerId: number,
    targetPlayerPuuid: string,
  ): PlayerConfigEntry[] {
    const targetRow = this.#parseProfile(
      this.#database
        .query(
          `SELECT
             source_account_id AS accountId,
             alias,
             discord_id AS discordId,
             source_player_id AS playerId,
             puuid,
             region,
             server_id AS serverId
           FROM profiles
           WHERE source_player_id = ? AND puuid = ?`,
        )
        .get(targetPlayerId, targetPlayerPuuid),
    );
    if (targetRow === undefined) {
      throw new Error(
        `Beta player ${String(targetPlayerId)} does not own account ${targetPlayerPuuid}`,
      );
    }
    const profiles: PlayerConfigEntry[] = [];
    for (const participant of rawMatch.info.participants) {
      const profile = this.#profileForServer(
        targetRow.serverId,
        participant.puuid,
      );
      if (profile !== undefined) profiles.push(this.#toPlayerConfig(profile));
    }
    return PlayerConfigSchema.parse(profiles);
  }

  public close(): void {
    this.#database.close();
  }
}
