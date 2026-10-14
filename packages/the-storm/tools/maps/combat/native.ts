import { randomBytes } from "node:crypto";
import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod";
import { serverLogs } from "@shepherdjerred/mc-harness/providers/docker/docker-cli.ts";
import { connectBot, disconnectBot } from "#e2e/harness/bot.ts";
import { startFakeBrain, setRwfKits } from "#e2e/harness/fake-brain.ts";
import type { startServer } from "#e2e/harness/server.ts";
import { RconClient } from "#e2e/harness/rcon.ts";
import { eventually, status } from "#e2e/harness/rwf-match.ts";
import { rwfTestSettings } from "#e2e/harness/rwf-settings.ts";
import { startClient } from "#client/process.ts";
import {
  request,
  StatusSchema,
  waitFor,
  type Session,
} from "#client/protocol.ts";
import { VideoStatus } from "#client/video-frames.ts";
import { encodeVideo } from "#client/video.ts";
import { stageMap } from "#learning/maps/stage.ts";
import { prepareOutputDirectory } from "#maps/cli.ts";
import { freezeInputs, type ConversionInputs } from "#maps/inputs.ts";
import { root, startRuntimeMapServer } from "#maps/paper.ts";
import {
  authoredCombatContract,
  AuthoredCombatCapture,
  AuthoredCombatProbe,
  summarizeAuthoredCombat,
} from "./wire.ts";
import { authoredCombatMatch, trooperCombatProfile } from "./profile.ts";
import { configureHostFeatures, selectHardHost } from "./settings.ts";

const output = await prepareOutputDirectory();
const frozen = await freezeInputs(root, output);
const save = (file: string, value: unknown) =>
  Bun.write(path.join(output, file), JSON.stringify(value, null, 2) + "\n");
await save("contract.json", authoredCombatContract);
await requireAuthoredInputs(frozen);
const staged = await stageMap(
  frozen.content,
  path.join(output, "map-content"),
  "training-yard",
  {
    duel: false,
    mapTool: path.join(frozen.mapTool, "bin/rwfmap"),
  },
);
await prepareNavigation(frozen, staged);
const privateRwf = path.join(staged.content, "rwf.yml");
const profile = trooperCombatProfile(
  Bun.YAML.parse(await Bun.file(privateRwf).text()),
);
await Bun.write(privateRwf, profile.text);
const readback = trooperCombatProfile(
  Bun.YAML.parse(await Bun.file(privateRwf).text()),
);
if (
  JSON.stringify(readback.original) !==
  JSON.stringify(profile.configuration.experience)
)
  throw new Error("Private initial Trooper profile did not read back exactly");
await save("settings.json", {
  kind: "private-preboot-profile",
  original: profile.original,
  staged: readback.original,
  appliesBeforeFirstBallot: true,
  ownedConfigurationChanged: false,
});
const token = randomBytes(24).toString("hex");
const brain = startFakeBrain(token);
let server: Awaited<ReturnType<typeof startServer>> | undefined;
let connection: RconClient | undefined;
let human: Awaited<ReturnType<typeof connectBot>> | undefined;
let camera: Awaited<ReturnType<typeof startClient>> | undefined;
let session: Session | undefined;
const journal: { command: string; response: unknown }[] = [];
try {
  await save("feature-settings.json", await configureHostFeatures(brain.port));
  await save("match-settings.json", {
    source: "private-ordinary-match-overlay",
    match: authoredCombatMatch,
    reason:
      "Retain the arena during the unchanged 540-frame recording after an ordinary match ends",
    participantHealthOrProtectionChanged: false,
    ownedConfigurationChanged: false,
  });
  server = await startRuntimeMapServer({
    inputs: frozen,
    content: staged.content,
    brain: {
      baseUrl: `http://host.docker.internal:${brain.port.toString()}`,
      token,
    },
    match: authoredCombatMatch,
    cacheDir: path.join(root, ".cache/e2e/authored-combat"),
    recordingsDir: path.join(output, "recordings"),
  });
  if (server.info.kind !== "container")
    throw new Error("Authored combat requires an owned disposable container");
  connection = await RconClient.connect({
    host: server.info.host,
    port: server.info.rconPort,
    password: server.info.rconPassword,
  });
  const rcon = connection;
  const native = async (command: string) => {
    const raw = await rcon.command(`storm-fixture-authored-combat ${command}`);
    const response: unknown = JSON.parse(raw);
    journal.push({ command, response });
    await save("journal.json", journal);
    return response;
  };
  const observe = async (command: string) =>
    AuthoredCombatCapture.parse(await native(command));
  const contract: unknown = JSON.parse(
    await rcon.command("storm-fixture-authored-combat contract"),
  );
  if (JSON.stringify(contract) !== JSON.stringify(authoredCombatContract))
    throw new Error(
      "Native authored combat producer differs from neutral contract",
    );
  await eventually(
    "ordinary private Training Yard ready",
    async () => {
      const value = await status(rcon);
      return value.ready && value.phase === "Lobby";
    },
    600_000,
  );
  const privateDir = await mkdtemp(path.join(tmpdir(), "rwf-authored-combat-"));
  session = {
    socket: path.join(privateDir, "camera.sock"),
    control: path.join(privateDir, "unused-control.sock"),
    artifacts: output,
    server: `127.0.0.1:${server.info.gamePort.toString()}`,
  };
  camera = await startClient({
    session,
    privateDir,
    packageRoot: root,
    onExit: () => {
      console.warn("Native authored-combat camera exited");
    },
  });
  await rcon.command("gamemode spectator StormPreview");
  human = await connectBot({
    host: server.info.host,
    port: server.info.gamePort,
    username: "RwfCombatProof",
  });
  const subject = z.uuid().parse(human.player.uuid);
  await setRwfKits(brain.port, [subject]);
  const messages: string[] = [];
  human.on("messagestr", (line: string) => {
    messages.push(line);
  });
  human.chat("/rwf join");
  await save(
    "host-settings.json",
    await selectHardHost(human, () => native("settings")),
  );
  await eventually(
    "original ordinary two-participant LIVE match",
    async () => {
      const value = await status(rcon);
      return (
        value.phase === "Live" &&
        value.map === "training-yard" &&
        value.humans === 1 &&
        value.bots === 1 &&
        value.arriving === 0
      );
    },
    180_000,
  );
  const live = await status(rcon);
  const match = z.uuid().parse(live.matchId);
  await waitFor(
    "actual original LIVE body readiness and expired native spawn protection",
    async () =>
      AuthoredCombatProbe.parse(await native(`probe ${match} ${subject}`)),
    (value) => value.ready,
    30_000,
  );
  const armed = await observe(`arm ${match} ${subject}`);
  await save("player.json", {
    source: "automated-native-protocol-player",
    humanDemonstration: false,
    command: "/rwf join",
    body: subject,
    match,
    bot: armed.bot,
    joinedMode: "SURVIVAL",
    controls: "human look/forward/jump only; no attacks",
    observer: "StormPreview, spectator outside match roster",
    learningFlag: false,
    acceptedActorAssets: 0,
    retries: 0,
  });
  const result = await drive({ player: human, session, rcon, observe });
  await save("terminal.json", result.capture);
  const summary = summarizeAuthoredCombat(result.capture);
  const video = await waitFor(
    "authored NPC melee video",
    async () =>
      VideoStatus.parse(await request(result.session, "video-status")),
    (value) => value.state === "COMPLETE" || value.state === "FAILED",
    60_000,
  );
  if (video.state !== "COMPLETE")
    throw new Error(`Authored combat video failed: ${video.error}`);
  const encoded = await encodeVideo(video.receipt);
  await request(result.session, "capture", { name: "after-authored-combat" });
  await save("player-transcript.json", {
    source: "automated-native-protocol-player",
    messages,
  });
  await frozen.check();
  await save("results.json", {
    ...summary,
    retries: 0,
    container: server.info.containerId,
    producer: frozen.hashes,
    video: encoded,
    videoStartedTick: result.videoStartedTick,
    videoMeleeEvents: result.capture.hits.filter(
      (hit) =>
        hit.before.serverTick >= result.videoStartedTick &&
        hit.monitor.human.health < hit.before.human.health,
    ).length,
  });
} catch (error) {
  await save("failure.json", {
    kind: "rwf-authored-npc-human-combat",
    humanDemonstration: false,
    retries: 0,
    message: error instanceof Error ? error.message : String(error),
  });
  if (connection !== undefined) {
    const state = await failureSnapshot(connection);
    await Bun.write(
      path.join(output, "failure-native-state.json"),
      state + "\n",
    );
  }
  throw error;
} finally {
  await cleanup();
}

async function cleanup() {
  human?.clearControlStates();
  try {
    if (human !== undefined) await disconnectBot(human);
  } finally {
    try {
      await camera?.stop();
    } finally {
      try {
        if (server !== undefined)
          await Bun.write(
            path.join(output, "server.log"),
            await serverLogs(server.info),
          );
      } finally {
        connection?.close();
        try {
          await server?.stop();
        } finally {
          await brain.stop();
        }
      }
    }
  }
}

async function failureSnapshot(rcon: RconClient) {
  try {
    return await rcon.command("storm-fixture-authored-combat sample");
  } catch (error) {
    return JSON.stringify({ readFailure: String(error) });
  }
}

async function requireAuthoredInputs(inputs: ConversionInputs) {
  const files = await readdir(inputs.content, { recursive: true });
  if (files.some((file) => file.startsWith("rwfbots/learning/accepted/")))
    throw new Error("Authored-only native proof refuses accepted actor assets");
}

async function prepareNavigation(
  inputs: ConversionInputs,
  privateMap: Awaited<ReturnType<typeof stageMap>>,
) {
  const lobby = path.join(privateMap.content, "rwf/lobby");
  for (const [action, folder] of [
    ["bake", privateMap.selected],
    ["verify", privateMap.selected],
    ["bake-lobby", lobby],
    ["verify-lobby", lobby],
  ] as const) {
    const child = Bun.spawn(
      [
        "mise",
        "exec",
        "--",
        path.join(inputs.mapTool, "bin/rwfmap"),
        action,
        folder,
      ],
      { stdout: Bun.file(path.join(output, `${action}.log`)), stderr: "pipe" },
    );
    const stderr = await new Response(child.stderr).text();
    if ((await child.exited) !== 0)
      throw new Error(
        `Private authored combat map ${action} failed: ${stderr}`,
      );
  }
}

type Capture = z.infer<typeof AuthoredCombatCapture>;
async function drive(options: {
  player: Awaited<ReturnType<typeof connectBot>>;
  session: Session;
  rcon: RconClient;
  observe: (request: string) => Promise<Capture>;
}) {
  const { player, session: clientSession, rcon, observe } = options;
  const deadline = Date.now() + 60_000;
  let videoStartedTick: number | undefined;
  let previous = player.entity.position.clone();
  let stuck = 0;
  while (Date.now() < deadline) {
    const value = await observe("sample");
    if (value.state !== "observing")
      throw new Error(
        `Ordinary authored combat observer ${value.state}: ${value.message}`,
      );
    const pose = value.frames.at(-1);
    if (pose === undefined) throw new Error("Native combat body pose missing");
    const [x, y, depth] = pose.bot.position;
    const dx = x - player.entity.position.x;
    const dz = depth - player.entity.position.z;
    const distance = Math.hypot(dx, dz);
    if (videoStartedTick === undefined && distance < 10) {
      player.clearControlStates();
      const px = pose.human.position[0];
      const pz = pose.human.position[2];
      await rcon.command(
        `execute at RwfCombatProof run tp StormPreview ${((px + x) / 2).toFixed(3)} ${(y + 12).toFixed(3)} ${((pz + depth) / 2 + 15).toFixed(3)} 180 38`,
      );
      await readyCamera(clientSession);
      await request(clientSession, "capture", {
        name: "before-authored-combat",
      });
      await request(clientSession, "video-arm", {
        name: "authored-npc-human",
        frames: 540,
        fov: 70,
      });
      await waitFor(
        "authored-combat spectator camera ready",
        async () =>
          VideoStatus.parse(await request(clientSession, "video-status")),
        (cameraStatus) => cameraStatus.state === "READY",
        30_000,
      );
      await request(clientSession, "video-start");
      const cameraStart = await observe("sample");
      videoStartedTick = cameraStart.sampledTick;
    }
    const started = videoStartedTick;
    if (
      started !== undefined &&
      value.pending === 0 &&
      value.hits.some(
        (hit) =>
          hit.before.serverTick >= started &&
          hit.cancelled &&
          !hit.before.human.invulnerable &&
          hit.before.human.noDamageTicks === 0 &&
          hit.monitor.human.health < hit.before.human.health &&
          hit.after.human.health < hit.before.human.health,
      )
    ) {
      player.clearControlStates();
      return {
        capture: await observe("finish"),
        session: clientSession,
        videoStartedTick: started,
      };
    }
    stuck =
      player.entity.position.distanceTo(previous) < 0.05 && distance > 2.4
        ? stuck + 1
        : 0;
    previous = player.entity.position.clone();
    await player.look(Math.atan2(-dx, -dz), 0, true);
    player.setControlState("forward", distance > 2.4);
    player.setControlState(
      "jump",
      distance > 2.4 && (y > player.entity.position.y + 0.4 || stuck >= 4),
    );
    await Bun.sleep(100);
  }
  throw new Error(
    "Ordinary authored NPC did not establish a retained melee HP loss within the original bounded match",
  );
}

async function readyCamera(clientSession: Session) {
  let stableSince: number | undefined;
  await waitFor(
    "loaded ordinary-match spectator world and stable native rendering",
    async () => StatusSchema.parse(await request(clientSession, "status")),
    (value) => {
      if (
        !value.connected ||
        value.world !== `minecraft:${rwfTestSettings.world}` ||
        value.screen !== "" ||
        value.fps < 30
      ) {
        stableSince = undefined;
        return false;
      }
      const now = performance.now();
      stableSince ??= now;
      return now - stableSince >= 2000;
    },
    30_000,
  );
}
