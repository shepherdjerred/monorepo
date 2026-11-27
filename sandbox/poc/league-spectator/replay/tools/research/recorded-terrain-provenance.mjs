import assert from "node:assert/strict";
import { Database } from "bun:sqlite";
import { basename } from "node:path";
import { validateReplayContainer } from "../../../../../../packages/scout-for-lol/packages/backend/src/scout-client/replay/container.ts";
import { parseObservedReplayProvenance } from "../../../../../../packages/scout-for-lol/packages/backend/src/scout-client/replay/provenance.ts";

export async function verifyRecordedRift({
  recoveryPath,
  replayPath,
  bytes,
  replay,
}) {
  const match = /^([A-Z0-9]+)-(\d{1,32})\.rofl$/u.exec(basename(replayPath));
  assert.ok(match, "Expected the original PLATFORM-gameId.rofl filename");
  const [, platform, gameId] = match;
  const database = new Database(recoveryPath, { readonly: true });
  let rows;
  try {
    rows = database
      .query(
        `
        SELECT CAST(full_game AS TEXT) AS body
        FROM game_recovery
        WHERE platform = ? AND game_id = ? AND full_game IS NOT NULL
      `,
      )
      .all(platform, gameId);
  } finally {
    database.close();
  }
  assert.ok(
    rows.length > 0,
    "Scout Desktop has no saved recovery for this replay",
  );
  const footers = JSON.parse(
    JSON.parse(bytes.subarray(replay.end + 256, -4).toString("utf8")).statsJson,
  );
  assert.equal(footers.length, 10, "Recorded Rift requires ten participants");
  const footerIds = new Set(footers.map((row) => row.PUUID));
  assert.equal(footerIds.size, 10);
  for (const team of [100, 200])
    assert.equal(replay.roster.filter((row) => row.team === team).length, 5);
  let queueId;
  for (const { body } of rows) {
    const game = JSON.parse(body);
    assert.ok(
      String(game.gameId) === gameId,
      "Incorrect recovered match identity",
    );
    assert.equal(game.platformId, platform);
    assert.equal(game.gameVersion, replay.build);
    assert.ok(Number.isSafeInteger(game.queueId) && game.queueId >= 0);
    if (queueId !== undefined) assert.equal(game.queueId, queueId);
    queueId = game.queueId;
    const recoveryIds = new Set(
      game.participantIdentities.map((identity) => identity.player.puuid),
    );
    assert.ok(
      recoveryIds.size === footerIds.size &&
        [...footerIds].every((id) => recoveryIds.has(id)),
      "Recovered and recorded rosters differ",
    );
    const provenance = parseObservedReplayProvenance({
      payload: { data: game },
      localPuuid: footers[0].PUUID,
      leaguePatch: game.gameVersion,
      requestedGameId: gameId,
      requestedPlatformId: platform,
    });
    assert.ok(
      provenance,
      "Saved recovery lacks a replay participant fingerprint",
    );
    assert.equal(provenance.mapId, 11);
    assert.equal(provenance.gameMode, "CLASSIC");
    assert.deepEqual(provenance.teamSizes, [5, 5]);
    const verified = await validateReplayContainer(
      replayPath,
      bytes.length,
      provenance,
    );
    assert.equal(verified.protocol, replay.protocol);
    assert.equal(verified.durationSeconds, replay.duration);
  }
  return { mapId: 11, gameMode: "CLASSIC", queueId };
}
