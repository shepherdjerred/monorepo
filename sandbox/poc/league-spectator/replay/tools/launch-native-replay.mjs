// Private Windows research tool. Only contacts the running Riot client on loopback.
import { execFile } from "node:child_process";
import { createHash, X509Certificate } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { request } from "node:https";
import { basename, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { parseArgs, promisify } from "node:util";
import { openReplay } from "../transport.mjs";
import {
  requestApi,
  validateLoadedReplayLength,
} from "./capture-reference-positions.mjs";

const usage = `Usage: bun launch-native-replay.mjs <local NA1-gameId.rofl> --ca <riotgames.pem>
  [--installation <League of Legends directory>] [--expected-sha256 <hex>]
  [--expected-client-length <seconds>]

Use the signed-in, idle Windows League client. The default installation is
C:/Riot Games/League of Legends. The replay must be in the client's replay
directory and match the running build. A client length override requires the
expected SHA-256 of the exact local ROFL. The API exposes length and process ID.
To corroborate the replay filename independently, search the latest GameLogs
r3dlog and LeagueClient log for the basename with rg -l -F; report filenames only.`;

function makeLcuRequest(lockfile, ca) {
  const [name, pid, port, password, protocol, extra] = lockfile
    .trim()
    .split(":");
  if (
    name !== "LeagueClient" ||
    !/^[1-9]\d*$/.test(pid) ||
    !/^[1-9]\d*$/.test(port) ||
    Number(port) > 65535 ||
    !password ||
    protocol !== "https" ||
    extra !== undefined
  )
    throw Error("Invalid League Client lockfile");
  const authorization =
    "Basic " + Buffer.from(`riot:${password}`).toString("base64");
  return (path, method = "GET") =>
    new Promise((resolve, reject) => {
      const posting = method === "POST";
      const req = request(
        {
          hostname: "127.0.0.1",
          port: Number(port),
          path,
          method,
          ca,
          rejectUnauthorized: true,
          signal: AbortSignal.timeout(5000),
          headers: {
            Authorization: authorization,
            Accept: "application/json",
            ...(posting
              ? { "Content-Type": "application/json", "Content-Length": "2" }
              : {}),
          },
        },
        async (response) => {
          try {
            const chunks = [];
            let length = 0;
            for await (const chunk of response) {
              length += chunk.length;
              if (length > 512 * 1024)
                throw Error("LCU response exceeds 512 KiB");
              chunks.push(chunk);
            }
            const value = length
              ? JSON.parse(Buffer.concat(chunks).toString("utf8"))
              : null;
            resolve({
              status: response.statusCode,
              allow: response.headers.allow,
              value,
            });
          } catch {
            reject(Error("LCU response could not be read as bounded JSON"));
          }
        },
      );
      req.on("error", (cause) =>
        reject(Error(`LCU request failed (${cause.code ?? "unknown"})`)),
      );
      req.end(posting ? "{}" : undefined);
    });
}

async function assertNoRunningGame() {
  const { stdout } = await promisify(execFile)(
    join(process.env.SystemRoot ?? "C:/Windows", "System32", "tasklist.exe"),
    ["/FI", "IMAGENAME eq League of Legends.exe", "/FO", "CSV", "/NH"],
    { windowsHide: true, timeout: 5000 },
  );
  if (/^"League of Legends\.exe",/im.test(stdout))
    throw Error(
      "League of Legends is already running. Close it before launching a replay.",
    );
}

async function readyReplay(ca, timeoutMilliseconds) {
  const deadline = Date.now() + timeoutMilliseconds;
  for (;;) {
    try {
      const game = await requestApi(ca, "game");
      const playback = await requestApi(ca, "playback");
      if (!Number.isSafeInteger(game.processID) || game.processID <= 0)
        throw Error("Replay API returned an invalid game process ID");
      await requestApi(ca, "render");
      return { game, playback };
    } catch (error) {
      // The game can listen before it has registered the replay endpoints.
      const starting =
        error.cause?.code === "ECONNREFUSED" || error.cause?.statusCode === 404;
      if (!starting || Date.now() >= deadline) throw error;
      await delay(500);
    }
  }
}

async function main() {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      ca: { type: "string" },
      installation: {
        type: "string",
        default: "C:/Riot Games/League of Legends",
      },
      "expected-sha256": { type: "string" },
      "expected-client-length": { type: "string" },
      help: { type: "boolean" },
    },
  });
  if (values.help) {
    console.log(usage);
    return;
  }
  if (process.platform !== "win32" || positionals.length !== 1 || !values.ca)
    throw Error(usage);
  const hash = values["expected-sha256"];
  const rawLength = values["expected-client-length"];
  const clientLength = rawLength === undefined ? undefined : Number(rawLength);
  if (
    (hash !== undefined && !/^[a-f0-9]{64}$/.test(hash)) ||
    (clientLength !== undefined &&
      (!hash || !Number.isFinite(clientLength) || clientLength <= 0))
  )
    throw Error(
      "Expected a lowercase ROFL SHA-256 and a positive client length",
    );

  const replayPath = await realpath(positionals[0]);
  const filename = basename(replayPath);
  const match = /^NA1-([1-9]\d*)\.rofl$/i.exec(filename);
  const gameId = Number(match?.[1]);
  if (!Number.isSafeInteger(gameId))
    throw Error("Expected a local NA1-gameId.rofl file");
  const bytes = Uint8Array.from(await readFile(replayPath));
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (hash !== undefined && digest !== hash)
    throw Error("Local ROFL SHA-256 differs from the provided identity");
  const replay = openReplay(bytes.buffer);
  const ca = new X509Certificate(await readFile(values.ca)).toString();
  await assertNoRunningGame();
  try {
    await requestApi(ca, "game");
    throw Error("The native Replay API is already active");
  } catch (error) {
    if (error.cause?.code !== "ECONNREFUSED") throw error;
  }

  const lcu = makeLcuRequest(
    await readFile(join(resolve(values.installation), "lockfile"), "utf8"),
    ca,
  );
  const watchPath = `/lol-replays/v1/rofls/${gameId}/watch`;
  const [help, phase, session, version, directory, metadata, options] =
    await Promise.all([
      lcu("/help"),
      lcu("/lol-gameflow/v1/gameflow-phase"),
      lcu("/lol-login/v1/session"),
      lcu("/lol-patch/v1/game-version"),
      lcu("/lol-replays/v1/rofls/path"),
      lcu(`/lol-replays/v1/metadata/${gameId}`),
      lcu(watchPath, "OPTIONS"),
    ]);
  if (phase.status !== 200 || phase.value !== "None")
    throw Error("League Client is not idle");
  if (
    session.status !== 200 ||
    session.value?.state !== "SUCCEEDED" ||
    session.value?.connected !== true
  )
    throw Error("League Client does not have a connected signed-in session");
  const [major, minor, ...build] = replay.build.split(".");
  const compatibility = `${major}.${minor}.${build.join("")}`;
  if (version.status !== 200 || version.value?.split("+")[0] !== compatibility)
    throw Error(
      "Local ROFL build differs from the running League Client build",
    );
  if (
    directory.status !== 200 ||
    typeof directory.value !== "string" ||
    (await realpath(join(directory.value, filename))).toLowerCase() !==
      replayPath.toLowerCase()
  )
    throw Error(
      "Local ROFL is not the matching file in the League Client replay directory",
    );
  if (
    metadata.status !== 200 ||
    metadata.value?.gameId !== gameId ||
    metadata.value?.state !== "watch"
  )
    throw Error(
      "League Client did not advertise this local replay as ready to watch",
    );
  if (
    help.status !== 200 ||
    !Object.hasOwn(
      help.value?.functions ?? {},
      "PostLolReplaysV1RoflsByGameIdWatch",
    ) ||
    options.status !== 204 ||
    !options.allow?.split(/,\s*/).includes("POST")
  )
    throw Error("League Client did not advertise the local replay watch route");
  await assertNoRunningGame();
  const watch = await lcu(watchPath, "POST");
  if (watch.status !== 204)
    throw Error(`League Client replay watch returned HTTP ${watch.status}`);
  const { game, playback } = await readyReplay(ca, 30000);
  validateLoadedReplayLength(
    playback,
    replay.durationMilliseconds / 1000,
    clientLength,
  );
  console.log(
    JSON.stringify(
      {
        replay: filename,
        sha256: digest,
        build: replay.build,
        processId: game.processID,
        footerLengthSeconds: replay.durationMilliseconds / 1000,
        nativeLengthSeconds: playback.length,
        watchStatus: watch.status,
      },
      null,
      2,
    ),
  );
}

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
