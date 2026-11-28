import assert from "node:assert/strict";
import { watch } from "node:fs";
import { mkdir, mkdtemp } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { LocalScoutTerrainManifestSchema } from "../../../../../packages/scout-for-lol/packages/app/e2e/public-replay/local-scout-terrain-manifest.ts";
import { openReplay } from "../../../../../packages/scout-for-lol/packages/replay/src/observations/transport.mjs";
import { verifyCanonicalRecordedRift } from "./research/verify-canonical-rift-replay.mjs";

const root = fileURLToPath(new URL("../../../../../", import.meta.url));
const scout = join(root, "packages/scout-for-lol/packages");
const releasePath = "/__replay_proof";
const usage = [
  "Usage: bun prove-paired-scout-replay.mjs <manifest.json> <replay.rofl>",
  "  <match-v5.json> <match-sha256> <uploader-champion> <oracle-directory>",
].join("\n");

function childEnv() {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (
      key.startsWith("SCOUT_REPLAY_E2E_") ||
      key.startsWith("SCOUT_REPLAY_PROOF_") ||
      key === "OP_SERVICE_ACCOUNT_TOKEN"
    )
      delete env[key];
  }
  return env;
}

function spawnScout(workspace, args, env) {
  return Bun.spawn([process.execPath, "--no-install", ...args], {
    cwd: join(scout, workspace),
    env,
    stdout: "inherit",
    stderr: "inherit",
  });
}

function loopbackProofHandoff(raw, gameId) {
  const url = new URL(raw.origin);
  assert.ok(
    url.protocol === "http:" &&
      url.hostname === "127.0.0.1" &&
      url.port !== "" &&
      url.href === `${url.origin}/` &&
      raw.origin === url.origin,
    "Expected an ephemeral loopback backend",
  );
  const replayId = raw.replayIds?.[gameId];
  assert.match(
    replayId,
    /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/u,
    "Missing paired replay ID",
  );
  return { url, replayId };
}

async function runPairedProof(input) {
  const { env, game, matchPath, ownerChampion, directory, verifyAudio } = input;
  const receiptFile = "handoff.json";
  const receiptPath = join(directory, receiptFile);
  const ready = Promise.withResolvers();
  const watcher = watch(directory, (_event, file) => {
    if (file === receiptFile) ready.resolve();
  });
  watcher.on("error", ready.reject);
  let backend;
  let releaseUrl;
  let error;
  try {
    backend = spawnScout(
      "backend",
      [
        "--bun",
        "vitest",
        "--config",
        "../../../../vitest.config.ts",
        "run",
        "src/scout-client/real-replay-upload.integration.test.ts",
      ],
      {
        ...env,
        DATABASE_URL: `postgres://scout@127.0.0.1:${env.SCOUT_PG_PORT}/scout_test_unbound`,
        SCOUT_REPLAY_PROOF_CANONICAL_MATCH: matchPath,
        SCOUT_REPLAY_PROOF_OWNER_CHAMPION: ownerChampion,
        SCOUT_REPLAY_PROOF_DIRECTORY: dirname(env.SCOUT_REPLAY_E2E_ROFL),
        SCOUT_REPLAY_PROOF_GAMES: JSON.stringify([game]),
        SCOUT_REPLAY_PROOF_HANDOFF: receiptPath,
      },
    );
    await Promise.race([
      ready.promise,
      backend.exited.then((status) => {
        throw Error(`Replay backend exited before handoff (${status})`);
      }),
    ]);
    const { url, replayId } = loopbackProofHandoff(
      await Bun.file(receiptPath).json(),
      game.gameId,
    );
    releaseUrl = new URL(releasePath, url);
    const result = await spawnScout(
      "app",
      [
        "--bun",
        "playwright",
        "test",
        "--config",
        "e2e/public-replay/recorded-playwright.config.ts",
        "--output",
        join(directory, "browser"),
      ],
      {
        ...env,
        SCOUT_REPLAY_E2E_REUSE_DIST: "1",
        SCOUT_REPLAY_E2E_WITH_ANNOUNCER: verifyAudio ? "1" : "0",
        SCOUT_REPLAY_E2E_BACKEND_ORIGIN: url.origin,
        SCOUT_REPLAY_E2E_BACKEND_REPLAY_ID: replayId,
      },
    ).exited;
    assert.equal(result, 0, "Signed-out browser proof failed");
  } catch (cause) {
    error = cause;
  } finally {
    watcher.close();
    if (releaseUrl !== undefined) {
      try {
        const response = await fetch(releaseUrl, {
          method: "DELETE",
          redirect: "error",
        });
        assert.equal(
          response.status,
          204,
          "Local replay handoff release failed",
        );
      } catch (cause) {
        error =
          error === undefined ? cause : new AggregateError([error, cause]);
      }
    }
  }
  const backendStatus = await backend?.exited;
  if (error !== undefined) throw error;
  assert.equal(backendStatus, 0, "Paired upload or backend teardown failed");
}

if (process.argv[2] === "--help") {
  console.log(usage);
} else {
  const [
    manifestArg,
    roflArg,
    matchArg,
    matchDigest,
    ownerChampion,
    oracleArg,
  ] = process.argv.slice(2);
  assert.ok(
    process.argv.length === 8 &&
      /^[a-f0-9]{64}$/u.test(matchDigest) &&
      /^[a-z0-9_]+$/iu.test(ownerChampion),
    usage,
  );
  const [manifestPath, roflPath, matchPath, oracleDirectory] = [
    manifestArg,
    roflArg,
    matchArg,
    oracleArg,
  ].map((path) => resolve(path));
  const filename = /^NA1-([1-9]\d*)\.rofl$/u.exec(basename(roflPath));
  assert.ok(filename, "Expected the original NA1 replay filename");
  const replayBytes = await Bun.file(roflPath).arrayBuffer();
  const replay = openReplay(replayBytes);
  const { queueId } = await verifyCanonicalRecordedRift(
    matchPath,
    matchDigest,
    roflPath,
    replay,
  );
  const manifest = LocalScoutTerrainManifestSchema.parse(
    await Bun.file(manifestPath).json(),
  );
  assert.equal(manifest.gameBuild, replay.build);
  assert.equal(manifest.protocol, replay.protocol);
  if (manifest.capabilities.rosterCoverage === "recorded-replay") {
    assert.equal(
      manifest.capabilities.replaySha256,
      new Bun.CryptoHasher("sha256").update(replayBytes).digest("hex"),
      "The package belongs to another replay",
    );
  }

  const inherited = childEnv();
  const databasePort = Number(inherited.SCOUT_PG_PORT || 5471);
  assert.ok(
    Number.isInteger(databasePort) &&
      databasePort > 0 &&
      databasePort <= 65_535,
    "Expected SCOUT_PG_PORT to be a local PostgreSQL port",
  );
  const cache = join(root, ".cache");
  await mkdir(cache, { recursive: true });
  const directory = await mkdtemp(join(cache, "scout-paired-proof-"));
  const portProbe = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () => new Response(null, { status: 204 }),
  });
  const port = String(portProbe.port);
  await portProbe.stop();
  const env = {
    ...inherited,
    SCOUT_PG_PORT: String(databasePort),
    SCOUT_REPLAY_E2E_BUILD_NAME: basename(directory).toLowerCase() + "-dist",
    SCOUT_REPLAY_E2E_MANIFEST: manifestPath,
    SCOUT_REPLAY_E2E_PORT: port,
    SCOUT_REPLAY_E2E_ROFL: roflPath,
    SCOUT_REPLAY_E2E_STATS_ORACLE_DIRECTORY: oracleDirectory,
    ...(process.env.SCOUT_REPLAY_E2E_EXPECT_CHAMPION_OVERHEAD === "1"
      ? { SCOUT_REPLAY_E2E_EXPECT_CHAMPION_OVERHEAD: "1" }
      : {}),
  };
  const appBuild = await spawnScout(
    "app",
    [
      "--bun",
      "vite",
      "build",
      "--config",
      "e2e/public-replay/recorded-vite.config.ts",
    ],
    env,
  ).exited;
  assert.equal(appBuild, 0, "Could not build the recorded Scout preview");
  await runPairedProof({
    env,
    game: { gameId: filename[1], durationSeconds: replay.duration, queueId },
    matchPath,
    ownerChampion,
    directory,
    verifyAudio: manifest.capabilities.announcerPreview !== undefined,
  });
  console.log(
    `Paired upload and signed-out playback passed. Evidence: ${directory}`,
  );
}
