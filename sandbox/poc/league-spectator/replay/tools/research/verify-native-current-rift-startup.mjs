import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  currentTerrainClientArchiveSha256,
  currentTerrainPositionBuild,
  terrainPositionProtocol,
} from "./native-terrain-byte-codecs.mjs";

const observer = fileURLToPath(
  new URL("../inspect-8428-replay-startup.py", import.meta.url),
);

export async function verifyNativeCurrentRiftStartup(
  archive,
  replayPath,
  replay,
) {
  assert.equal(
    replay.build,
    currentTerrainPositionBuild,
    "Native Rift startup requires the exact .8428 build",
  );
  assert.equal(replay.protocol, terrainPositionProtocol);
  for (const team of [100, 200])
    assert.equal(replay.roster.filter((row) => row.team === team).length, 5);
  assert.equal(replay.roster.length, 10);

  const command = Bun.spawn(
    [
      "uv",
      "run",
      "--offline",
      "--no-project",
      "--with",
      "unicorn==2.1.4",
      "python",
      observer,
      resolve(archive),
      resolve(replayPath),
      "--verify-malformed-controls",
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  const [exit, stdout, stderr] = await Promise.all([
    command.exited,
    new Response(command.stdout).text(),
    new Response(command.stderr).text(),
  ]);
  assert.equal(
    exit,
    0,
    `Original Rift startup observer failed: ${stderr.trim()}`,
  );
  const report = JSON.parse(stdout);
  assert.equal(report.archiveSha256, currentTerrainClientArchiveSha256);
  assert.equal(report.malformedControls, true);
  assert.equal(report.replays.length, 1);
  const [startup] = report.replays;
  assert.equal(startup.build, replay.build);
  assert.equal(startup.protocol, replay.protocol);
  assert.equal(
    startup.replaySha256,
    createHash("sha256").update(replay.bytes).digest("hex"),
  );
  assert.deepEqual(
    [startup.stream, startup.opcode, startup.chunkId, startup.offset],
    [3, 1022, 1, 0],
  );
  assert.match(startup.payloadSha256, /^[a-f0-9]{64}$/u);
  assert.ok(
    Number.isSafeInteger(startup.consumedBytes) && startup.consumedBytes > 0,
  );
  assert.deepEqual(
    [startup.configuredMapId, startup.mode],
    [11, "CLASSIC"],
    "Native Rift startup requires Map11 CLASSIC",
  );
  return startup;
}
