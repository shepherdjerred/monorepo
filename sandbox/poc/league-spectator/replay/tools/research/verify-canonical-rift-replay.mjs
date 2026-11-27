import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import {
  currentTerrainPositionBuild,
  terrainPositionProtocol,
} from "./native-terrain-byte-codecs.mjs";
import { readInventoryReplayFooter } from "./verify-recorded-inventory-footer.mjs";

const digest = (bytes) =>
  new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
const decoder = new TextDecoder("utf-8", { fatal: true });
const scoreFields = [
  ["CHAMPIONS_KILLED", "kills"],
  ["NUM_DEATHS", "deaths"],
  ["ASSISTS", "assists"],
];
for (let slot = 0; slot < 7; slot++)
  scoreFields.push([`ITEM${slot}`, `item${slot}`]);

/** Verify private Match-V5 evidence against the original saved replay footer. */
export async function verifyCanonicalRecordedRift(
  path,
  expectedSha256,
  replayPath,
  replay,
) {
  const bytes = await readFile(path);
  const sourceSha256 = digest(bytes);
  if (sourceSha256 !== expectedSha256)
    throw Error("Riot Match-V5 result differs from its reviewed digest");
  const { metadata, info } = JSON.parse(decoder.decode(bytes));
  const game = /^([A-Z0-9]+)-([1-9]\d{0,31})\.rofl$/u.exec(
    basename(replayPath),
  );
  if (
    game === null ||
    replay.build !== currentTerrainPositionBuild ||
    replay.protocol !== terrainPositionProtocol ||
    metadata?.matchId !== `${game[1]}_${game[2]}` ||
    !Array.isArray(metadata.participants) ||
    String(info?.gameId) !== game[2] ||
    info.gameVersion !== replay.build ||
    info.mapId !== 11 ||
    info.gameMode !== "CLASSIC" ||
    !Number.isSafeInteger(info.queueId) ||
    info.queueId < 0 ||
    !Number.isSafeInteger(info.gameDuration) ||
    Math.abs(info.gameDuration - replay.duration) > 1 ||
    !Array.isArray(info.participants) ||
    info.participants.length !== 10
  )
    throw Error("Riot Match-V5 result differs from the saved Rift replay");

  const participants = info.participants;
  const canonicalIds = new Set(metadata.participants);
  if (
    metadata.participants.length !== participants.length ||
    canonicalIds.size !== participants.length ||
    new Set(participants.map(({ participantId }) => participantId)).size !==
      participants.length ||
    participants.some(
      ({ puuid, participantId }) =>
        typeof puuid !== "string" ||
        puuid.length === 0 ||
        !canonicalIds.delete(puuid) ||
        !Number.isSafeInteger(participantId) ||
        participantId < 1 ||
        participantId > participants.length,
    ) ||
    [100, 200].some(
      (team) =>
        participants.filter(({ teamId }) => teamId === team).length !== 5,
    )
  )
    throw Error("Riot Match-V5 result lacks a complete standard Rift roster");

  const rows = JSON.parse(readInventoryReplayFooter(replay.bytes).statsJson);
  if (!Array.isArray(rows) || rows.length !== participants.length)
    throw Error("Saved replay lacks a complete Rift footer");
  const matched = new Set();
  for (const row of rows) {
    const candidates = participants.filter(
      (member) =>
        typeof row.RIOT_ID_GAME_NAME === "string" &&
        row.RIOT_ID_GAME_NAME.length > 0 &&
        typeof row.RIOT_ID_TAG_LINE === "string" &&
        row.RIOT_ID_TAG_LINE.length > 0 &&
        member.riotIdGameName === row.RIOT_ID_GAME_NAME &&
        member.riotIdTagline === row.RIOT_ID_TAG_LINE &&
        String(member.teamId) === row.TEAM &&
        member.championName === row.SKIN,
    );
    const member = candidates[0];
    if (candidates.length !== 1 || matched.has(member))
      throw Error("Riot Match-V5 lacks a unique replay footer participant");
    if (
      scoreFields.some(
        ([field, key]) =>
          !Number.isSafeInteger(member[key]) ||
          member[key] < 0 ||
          String(member[key]) !== row[field],
      )
    )
      throw Error(
        "Riot Match-V5 scoreboard or ordered items differ from the replay footer",
      );
    matched.add(member);
  }
  return {
    sourceSha256,
    verifiedSlots: matched.size * 7,
    queueId: info.queueId,
  };
}
