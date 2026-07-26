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
].join(",");

describe("Glitter trusted seed importer", () => {
  test("imports CSV entries deterministically and preserves quoted content", () => {
    const csv = [
      HEADER,
      '100,200,person,0,300,"hello, friend",,0,false,2025-01-01T00:00:00.000000+00:00,false,0',
      "101,201,other,0,300,goodbye,2025-01-03T00:00:00.000Z,0,false,2025-01-02T00:00:00.000000+00:00,false,0",
    ].join("\n");
    const archiveBytes = zipSync({
      "glitter-boys/channel_page_1.csv": new TextEncoder().encode(csv),
    });
    const input = {
      archiveBytes,
      archivePath: "glitter-boys.zip",
      importedAt: "2025-01-04T00:00:00.000Z",
      expectedUniqueMessages: 2,
    };

    const first = importSeedArchive(input);
    const second = importSeedArchive(input);
    expect(first.manifest.uniqueMessageCount).toBe(2);
    expect(first.manifest.duplicateMessageCount).toBe(0);
    expect(first.observations[0]?.content).toBe("hello, friend");
    expect(first.manifest.projectionSha256).toBe(
      second.manifest.projectionSha256,
    );
    expect(first.projectionNdjson).toBe(second.projectionNdjson);
  });

  test("fails when the unique-message acceptance count is wrong", () => {
    const csv = [
      HEADER,
      "100,200,person,0,300,hello,,0,false,2025-01-01T00:00:00.000Z,false,0",
    ].join("\n");
    const archiveBytes = zipSync({
      "glitter-boys/channel_page_1.csv": new TextEncoder().encode(csv),
    });
    expect(() =>
      importSeedArchive({
        archiveBytes,
        archivePath: "glitter-boys.zip",
        importedAt: "2025-01-04T00:00:00.000Z",
        expectedUniqueMessages: 2,
      }),
    ).toThrow("seed acceptance failed");
  });
});
