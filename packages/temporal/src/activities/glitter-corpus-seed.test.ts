import { describe, expect, test } from "bun:test";
import { zipSync } from "fflate";
import { importSeedArchive } from "./glitter-corpus-seed.ts";

const HEADER = [
  "id",
  "author.id",
  "author.username",
  "author.discriminator",
  "channel_id",
  "content",
  "edited_timestamp",
  "flags",
  "pinned",
  "timestamp",
  "tts",
  "type",
  "thread.guild_id",
].join(",");
const GUILD_ID = "208425771172102144";
const GUILD_SLUG = "glitter-boys";

describe("Glitter trusted seed importer", () => {
  test("imports CSV entries deterministically and preserves quoted content", () => {
    const csv = [
      HEADER,
      `100,200,person,0,300,"hello, friend",,0,false,2025-01-01T00:00:00.000000+00:00,false,0,${GUILD_ID}`,
      `101,201,other,0,300,goodbye,2025-01-03T00:00:00.000Z,0,false,2025-01-02T00:00:00.000000+00:00,false,0,${GUILD_ID}`,
    ].join("\n");
    const archiveBytes = zipSync({
      "glitter-boys/channel_page_1.csv": new TextEncoder().encode(csv),
    });
    const input = {
      archiveBytes,
      archivePath: "glitter-boys.zip",
      guildId: GUILD_ID,
      guildSlug: GUILD_SLUG,
      importedAt: "2025-01-04T00:00:00.000Z",
      expectedUniqueMessages: 2,
    };

    const first = importSeedArchive(input);
    const second = importSeedArchive(input);
    expect(first.manifest.uniqueMessageCount).toBe(2);
    expect(first.manifest.duplicateMessageCount).toBe(0);
    expect(first.manifest.guildId).toBe(GUILD_ID);
    expect(first.manifest.guildSlug).toBe(GUILD_SLUG);
    expect(first.manifest.archiveRoots).toEqual(["glitter-boys"]);
    expect(first.observations.every((item) => item.guildId === GUILD_ID)).toBe(
      true,
    );
    expect(first.observations[0]?.content).toBe("hello, friend");
    expect(first.manifest.projectionSha256).toBe(
      second.manifest.projectionSha256,
    );
    expect(first.projectionNdjson).toBe(second.projectionNdjson);
  });

  test("fails when the unique-message acceptance count is wrong", () => {
    const csv = [
      HEADER,
      `100,200,person,0,300,hello,,0,false,2025-01-01T00:00:00.000Z,false,0,${GUILD_ID}`,
    ].join("\n");
    const archiveBytes = zipSync({
      "glitter-boys/channel_page_1.csv": new TextEncoder().encode(csv),
    });
    expect(() =>
      importSeedArchive({
        archiveBytes,
        archivePath: "glitter-boys.zip",
        guildId: GUILD_ID,
        guildSlug: GUILD_SLUG,
        importedAt: "2025-01-04T00:00:00.000Z",
        expectedUniqueMessages: 2,
      }),
    ).toThrow("seed acceptance failed");
  });

  test("normalizes multiple archive roots to one explicit guild", () => {
    const glitterCsv = [
      HEADER,
      `100,200,person,0,300,hello,,0,false,2025-01-01T00:00:00.000Z,false,0,${GUILD_ID}`,
    ].join("\n");
    const leagueCsv = [
      HEADER,
      `101,201,other,0,301,world,,0,false,2025-01-02T00:00:00.000Z,false,0,${GUILD_ID}`,
    ].join("\n");
    const result = importSeedArchive({
      archiveBytes: zipSync({
        "glitter-boys/channel.csv": new TextEncoder().encode(glitterCsv),
        "league-of-legends/channel.csv": new TextEncoder().encode(leagueCsv),
      }),
      archivePath: "glitter-boys.zip",
      guildId: GUILD_ID,
      guildSlug: GUILD_SLUG,
      expectedUniqueMessages: 2,
    });

    expect(result.manifest.archiveRoots).toEqual([
      "glitter-boys",
      "league-of-legends",
    ]);
    expect(
      result.observations.every(
        (item) => item.guildId === GUILD_ID && item.guildSlug === GUILD_SLUG,
      ),
    ).toBe(true);
  });

  test("rejects an embedded thread guild mismatch", () => {
    const csv = [
      HEADER,
      "100,200,person,0,300,hello,,0,false,2025-01-01T00:00:00.000Z,false,0,999",
    ].join("\n");

    expect(() =>
      importSeedArchive({
        archiveBytes: zipSync({
          "glitter-boys/channel.csv": new TextEncoder().encode(csv),
        }),
        archivePath: "glitter-boys.zip",
        guildId: GUILD_ID,
        guildSlug: GUILD_SLUG,
        expectedUniqueMessages: 1,
      }),
    ).toThrow(`belongs to guild 999, expected ${GUILD_ID}`);
  });
});
