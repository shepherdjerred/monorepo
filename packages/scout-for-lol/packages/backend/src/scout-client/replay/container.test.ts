import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import nodePath from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { LeaguePuuidSchema } from "@scout-for-lol/domain/identity/league-account.ts";
import remake from "./patch-16.23-remake.fixture.json" with { type: "json" };
import {
  type ReplayProvenance,
  chunksAreTagged,
  validateReplayContainer,
} from "./container.ts";

// `patch-16.23-remake.fixture.json` is a real replay from a Windows client,
// minimized and redacted: its chunk table, game length and the stats the
// validator reads are as recorded; its player identities are synthetic and
// its chunk bodies are rebuilt as a zstd frame header followed by zeros.

type Participant = (typeof remake.participants)[number];
type Chunk = (typeof remake.chunks)[number];

const ZSTD_MAGIC = [0x28, 0xb5, 0x2f, 0xfd];

function chunkBytes(chunk: Chunk, tagged: boolean): Buffer {
  const header = Buffer.alloc(17);
  header.writeUInt32LE(chunk.id, 0);
  header.writeUInt32LE(chunk.next, 4);
  header.writeUInt8(chunk.type, 8);
  header.writeUInt32LE(chunk.uncompressedBytes, 9);
  header.writeUInt32LE(chunk.compressedBytes, 13);
  const body = Buffer.alloc(chunk.compressedBytes || chunk.uncompressedBytes);
  if (chunk.compressedBytes > 0) body.set(ZSTD_MAGIC, 0);
  return Buffer.concat([
    header,
    ...(tagged ? [Buffer.from([chunk.tag])] : []),
    body,
  ]);
}

function replay(options: {
  tagged?: boolean;
  chunks?: readonly Chunk[];
  participants?: readonly Participant[];
}): Buffer {
  const version = Buffer.from(remake.version, "ascii");
  const header = Buffer.alloc(15);
  header.write("RIOT", 0, "ascii");
  header.writeUInt16LE(2, 4);
  header[14] = version.byteLength;
  const metadata = Buffer.from(
    JSON.stringify({
      ...remake.metadata,
      statsJson: JSON.stringify(options.participants ?? remake.participants),
    }),
  );
  const metadataLength = Buffer.alloc(4);
  metadataLength.writeUInt32LE(metadata.byteLength);
  return Buffer.concat([
    header,
    version,
    ...(options.chunks ?? remake.chunks).map((chunk) =>
      chunkBytes(chunk, options.tagged ?? true),
    ),
    Buffer.alloc(256),
    metadata,
    metadataLength,
  ]);
}

function uploadedBy(player: Participant): ReplayProvenance {
  return {
    localPuuid: player.PUUID,
    leaguePatch: remake.version,
    gameDurationSeconds: Math.round(remake.metadata.gameLength / 1000),
    participant: {
      puuid: LeaguePuuidSchema.parse(player.PUUID),
      teamId: Number(player.TEAM),
      kills: Number(player.CHAMPIONS_KILLED),
      deaths: Number(player.NUM_DEATHS),
      assists: Number(player.ASSISTS),
      goldEarned: Number(player.GOLD_EARNED),
      goldSpent: Number(player.GOLD_SPENT),
      totalDamageDealtToChampions: Number(
        player.TOTAL_DAMAGE_DEALT_TO_CHAMPIONS,
      ),
      totalMinionsKilled: Number(player.MINIONS_KILLED),
      visionScore: Number(player.VISION_SCORE),
      wardsPlaced: Number(player.WARD_PLACED),
      wardsKilled: Number(player.WARD_KILLED),
      championLevel: Number(player.LEVEL),
      // Match evidence knows only whether the team won.
      win: player.WIN === "Win" ? "Win" : "Fail",
      items: [
        Number(player.ITEM0),
        Number(player.ITEM1),
        Number(player.ITEM2),
        Number(player.ITEM3),
        Number(player.ITEM4),
        Number(player.ITEM5),
        Number(player.ITEM6),
      ],
    },
  };
}

function participant(index: number): Participant {
  const found = remake.participants[index];
  if (found === undefined) throw new Error(`no participant ${String(index)}`);
  return found;
}

let directory = "";

beforeAll(async () => {
  directory = await mkdtemp(nodePath.join(tmpdir(), "scout-replay-"));
});

afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});

async function validate(
  bytes: Buffer,
  provenance: ReplayProvenance,
): Promise<void> {
  const path = nodePath.join(directory, `${crypto.randomUUID()}.rofl`);
  await writeFile(path, bytes);
  await validateReplayContainer(path, bytes.byteLength, provenance);
}

describe("a real patch 16.23 replay", () => {
  test("is accepted with its tagged chunks and a leaver on the team", async () => {
    expect(remake.chunks.every((chunk) => chunk.tag === 4)).toBe(true);
    expect(remake.participants.map((p) => p.WIN)).toContain("LeaverFail");
    await expect(
      validate(replay({}), uploadedBy(participant(0))),
    ).resolves.toBeUndefined();
  });

  test("is accepted when the uploader is the player who left", async () => {
    const leaver = participant(3);
    expect(leaver.WIN).toBe("LeaverFail");
    await expect(
      validate(replay({}), uploadedBy(leaver)),
    ).resolves.toBeUndefined();
  });

  test("is refused when its chunks lack the tag", async () => {
    await expect(
      validate(replay({ tagged: false }), uploadedBy(participant(0))),
    ).rejects.toThrow("Replay chunk");
  });

  test("is refused when a chunk tag is not 4", async () => {
    const chunks = remake.chunks.map((chunk, index) =>
      index === 2 ? { ...chunk, tag: 3 } : chunk,
    );
    await expect(
      validate(replay({ chunks }), uploadedBy(participant(0))),
    ).rejects.toThrow("Replay chunk table is invalid");
  });

  test("is refused when a compressed chunk is not zstd", async () => {
    const bytes = replay({});
    // The first chunk is compressed; break its frame magic after the tag.
    const firstBody = 15 + remake.version.length + 17 + 1;
    bytes[firstBody] = 0;
    await expect(validate(bytes, uploadedBy(participant(0)))).rejects.toThrow(
      "Replay chunk compression is invalid",
    );
  });

  test("still refuses an unknown result", async () => {
    const participants = remake.participants.map((p, index) =>
      index === 1 ? { ...p, WIN: "Draw" } : p,
    );
    await expect(
      validate(replay({ participants }), uploadedBy(participant(0))),
    ).rejects.toThrow("Replay participant metadata is invalid");
  });
});

test("chunk tags start with patch 16.21", () => {
  expect(chunksAreTagged("16.18.817.5716")).toBe(false);
  expect(chunksAreTagged("16.20.824.8524")).toBe(false);
  expect(chunksAreTagged("16.21.829.8620")).toBe(true);
  expect(chunksAreTagged("16.23.840.6595")).toBe(true);
  expect(chunksAreTagged("17.1.1.1")).toBe(true);
});
