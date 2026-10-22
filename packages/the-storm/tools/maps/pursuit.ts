import { mkdtemp } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod";
import { serverLogs } from "#e2e/harness/external/files.ts";
import { startFakeBrain } from "#e2e/harness/fake-brain.ts";
import { startServer } from "#e2e/harness/server.ts";
import { RconClient } from "#e2e/harness/rcon.ts";
import { startClient } from "#client/process.ts";
import { request, waitFor, type Session } from "#client/protocol.ts";
import { VideoStatus } from "#client/video-frames.ts";
import { encodeVideo } from "#client/video.ts";
import { freezeInputs } from "./inputs.ts";
import { root, mapServerConfig } from "./paper.ts";
import { prepareOutputDirectory } from "./cli.ts";
import wire from "#pursuit-wire";

const output = await prepareOutputDirectory();
const inputs = await freezeInputs(root, output);
const Observation = z.strictObject({
  tick: z.number().int().nonnegative(),
  position: z.tuple([z.number(), z.number(), z.number()]),
  visible: z.boolean(),
  waypoints: z.number().int().nonnegative(),
  index: z.number().int().nonnegative(),
});
const State = z.strictObject({
  state: z.enum(["idle", "prepared", "running", "passed", "failed"]),
  ticks: z.number().int().nonnegative(),
  routed: z.boolean(),
  doorway: z.boolean(),
  swings: z.number().int().nonnegative(),
  attacks: z.number().int().nonnegative(),
  observations: z.array(Observation),
});
if (
  wire.version !== 1 ||
  JSON.stringify(wire.status) !== JSON.stringify(Object.keys(State.shape)) ||
  JSON.stringify(wire.observation) !==
    JSON.stringify(Object.keys(Observation.shape)) ||
  JSON.stringify(wire.states) !== JSON.stringify(State.shape.state.options) ||
  JSON.stringify(wire.position) !== JSON.stringify(["x", "y", "z"])
)
  throw new Error("Pursuit wire contract differs from reader");
const token = randomBytes(24).toString("hex");
const brain = startFakeBrain(token);
const brainUrl = `http://host.docker.internal:${brain.port.toString()}`;
let server: Awaited<ReturnType<typeof startServer>> | undefined;
let connection: RconClient | undefined;
let client: Awaited<ReturnType<typeof startClient>> | undefined;
try {
  server = await startServer({
    cacheDir: path.join(root, ".cache/e2e/pursuit"),
    bootTimeoutMs: 600_000,
    warmCache: true,
    ...(await mapServerConfig(inputs, { baseUrl: brainUrl, token })),
    resources: { cpus: 4, heap: "4G", memoryLimit: "6g" },
  });
  if (server.info.kind !== "container")
    throw new Error("Pursuit proof needs an owned disposable container");
  const container = server.info.containerId;
  connection = await RconClient.connect({
    host: server.info.host,
    port: server.info.rconPort,
    password: server.info.rconPassword,
  });
  const rcon = connection;
  const prepare = State.parse(
    JSON.parse(await rcon.command("storm-fixture-pursuit prepare")),
  );
  if (prepare.state !== "prepared")
    throw new Error("Pursuit preparation failed");
  const privateDir = await mkdtemp(path.join(tmpdir(), "rwf-pursuit-"));
  const session: Session = {
    socket: path.join(privateDir, "client.sock"),
    control: path.join(privateDir, "unused-control.sock"),
    artifacts: output,
    server: `127.0.0.1:${server.info.gamePort.toString()}`,
  };
  client = await startClient({
    session,
    privateDir,
    packageRoot: root,
    onExit: () => {
      console.warn("Native pursuit observer exited");
    },
  });
  await rcon.command("gamemode spectator StormPreview");
  await rcon.command("tp StormPreview 307 108 315 180 45");
  await Bun.sleep(2000);
  await request(session, "capture", { name: "before-pursuit" });
  await request(session, "video-arm", {
    name: "pursuit",
    frames: 1080,
    fov: 70,
  });
  await waitFor(
    "pursuit camera readiness",
    async () => VideoStatus.parse(await request(session, "video-status")),
    (value) => value.state === "READY",
    30_000,
  );
  await rcon.command("storm-fixture-pursuit start");
  await request(session, "video-start");
  const result = await waitFor(
    "native pursuit outcome",
    async () => {
      const state = State.parse(
        JSON.parse(await rcon.command("storm-fixture-pursuit status")),
      );
      await Bun.write(
        path.join(output, "results.json"),
        JSON.stringify(
          {
            schema: 1,
            kind: "rwf-native-visible-pursuit-proof",
            container,
            producer: inputs.hashes,
            result: state,
            attackCommandsObservedOnly: true,
            damageAcceptance: false,
          },
          null,
          2,
        ) + "\n",
      );
      return state;
    },
    (value) => value.state === "passed" || value.state === "failed",
    45_000,
  );
  const video = await waitFor(
    "native pursuit video",
    async () => VideoStatus.parse(await request(session, "video-status")),
    (value) => value.state === "COMPLETE" || value.state === "FAILED",
    60_000,
  );
  if (video.state !== "COMPLETE")
    throw new Error(`Pursuit video failed: ${video.error}`);
  await encodeVideo(video.receipt);
  await request(session, "capture", { name: "after-pursuit" });
  await inputs.check();
  if (
    result.state !== "passed" ||
    !result.routed ||
    !result.doorway ||
    result.attacks < 1
  )
    throw new Error(
      "Native controller did not route through the doorway into sword contact",
    );
  console.warn(
    `Native visible pursuit passed in ${result.ticks.toString()} ticks: ${output}`,
  );
} finally {
  try {
    if (server !== undefined)
      await Bun.write(
        path.join(output, "server.log"),
        await serverLogs(server.info),
      );
  } finally {
    try {
      await client?.stop();
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
