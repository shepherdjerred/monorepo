import { randomBytes } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import { serverLogs } from "#e2e/harness/external/files.ts";
import { connectBot, disconnectBot, waitForMessage } from "#e2e/harness/bot.ts";
import { startFakeBrain, setRwfKits } from "#e2e/harness/fake-brain.ts";
import type { startServer } from "#e2e/harness/server.ts";
import { RconClient } from "#e2e/harness/rcon.ts";
import { eventually, status } from "#e2e/harness/rwf-match.ts";
import { stageMap } from "#learning/maps/stage.ts";
import { root, startRuntimeMapServer } from "./paper.ts";
import { freezeInputs, type ConversionInputs } from "./inputs.ts";
import {
  HealthStatus,
  healthContract,
  summarizeHealth,
} from "./health-wire.ts";

const args = parseArgs({
  strict: true,
  options: {
    output: { type: "string" },
    scenario: { type: "string", multiple: true },
  },
});
const output = path.resolve(z.string().min(1).parse(args.values.output));
const selected = z.array(z.string()).parse(args.values.scenario ?? []);
for (const name of selected)
  if (!healthContract.scenarios.some((scenario) => scenario.id === name))
    throw new Error(`Unknown health scenario ${name}`);
await mkdir(path.dirname(output), { recursive: true });
await mkdir(output, { recursive: false, mode: 0o700 });
const inputs = await freezeInputs(root, output);
const results = [];
for (const scenario of healthContract.scenarios.filter(
  (candidate) => selected.length === 0 || selected.includes(candidate.id),
)) {
  await inputs.check();
  results.push(await capture(scenario, inputs));
  await Bun.write(
    path.join(output, "results.json"),
    JSON.stringify(
      {
        version: 1,
        kind: "controlled-route-diagnostic",
        humanDemonstration: false,
        autonomousRoutingVerified: false,
        retries: 0,
        results,
      },
      null,
      2,
    ) + "\n",
  );
}
await inputs.check();

type Scenario = (typeof healthContract.scenarios)[number];
type State = z.infer<typeof HealthStatus>;
type Client = Awaited<ReturnType<typeof connectBot>>;

async function capture(scenario: Scenario, frozen: ConversionInputs) {
  const directory = path.join(output, scenario.id);
  await mkdir(directory, { mode: 0o700 });
  const save = (file: string, value: unknown) =>
    Bun.write(
      path.join(directory, file),
      JSON.stringify(value, null, 2) + "\n",
    );
  const staged = await stageMap(
    frozen.content,
    path.join(directory, "map-content"),
    "training-yard",
    { duel: false, mapTool: path.join(frozen.mapTool, "bin/rwfmap") },
  );
  await prepareNavigation(frozen, staged, directory);
  const token = randomBytes(24).toString("hex");
  const brain = startFakeBrain(token);
  let server: Awaited<ReturnType<typeof startServer>> | undefined;
  let rcon: RconClient | undefined;
  let player: Client | undefined;
  const journal: { command: string; response: unknown }[] = [];
  try {
    server = await startRuntimeMapServer({
      inputs: frozen,
      content: staged.content,
      brain: {
        baseUrl: `http://host.docker.internal:${brain.port.toString()}`,
        token,
      },
      match: { countdown: "PT15S" },
      cacheDir: path.join(root, ".cache/e2e/health-proof"),
      recordingsDir: path.join(directory, "recordings"),
    });
    if (server.info.kind !== "container")
      throw new Error("Health proof requires an owned disposable container");
    rcon = await RconClient.connect({
      host: server.info.host,
      port: server.info.rconPort,
      password: server.info.rconPassword,
    });
    const console = rcon;
    const command = async (request: string) => {
      const raw = await console.command(`storm-fixture-health ${request}`);
      const response: unknown = JSON.parse(raw);
      journal.push({ command: request, response });
      await save("journal.json", journal);
      return HealthStatus.parse(response);
    };
    const nativeContract: unknown = JSON.parse(
      await console.command("storm-fixture-health contract"),
    );
    if (JSON.stringify(nativeContract) !== JSON.stringify(healthContract))
      throw new Error(
        "Health native producer differs from the neutral consumer contract",
      );
    await eventually(
      "private Training Yard ready",
      async () => {
        const current = await status(console);
        return (
          current.ready &&
          current.phase === "Lobby" &&
          current.map === "training-yard"
        );
      },
      600_000,
    );
    player = await connectBot({
      host: server.info.host,
      port: server.info.gamePort,
      username: "RwfHealthProof",
    });
    const client = player;
    const body = z.uuid().parse(client.player.uuid);
    const messages: string[] = [];
    client.on("messagestr", (message: string) => {
      messages.push(message);
    });
    await setRwfKits(brain.port, [body]);
    if (scenario.kit === "juggernaut") {
      const credit = await console.command(
        "eco give RwfHealthProof 350 rwf_credits",
      );
      if (/unknown|error|failed/iu.test(credit))
        throw new Error("Native kit purchase credit setup refused");
      const purchased = waitForMessage(
        client,
        /Purchased kit Juggernaut for 350 credits!/u,
      );
      client.chat("/rwf buy juggernaut");
      await purchased;
    }
    client.chat("/rwf join");
    await eventually("original joined countdown", async () => {
      const value = await status(console);
      return value.phase === "Countdown";
    });
    await command(`bind ${body} ${scenario.id}`);
    await wait(
      command,
      (value) =>
        value.samples.length > 0 && value.samples.at(-1)?.noDamageTicks === 0,
      "real live kit and expired spawn damage window",
    );
    await save("player.json", {
      body,
      command: "/rwf join",
      selectedKit: scenario.kit,
      source: "automated-native-client",
      humanDemonstration: false,
      autonomousRoutingVerified: false,
      purchased: scenario.kit === "juggernaut",
      controls: "forward; Juggernaut additionally attempts sprint",
    });
    await drive(scenario, client, command);
    client.clearControlStates();
    const terminal = await command("close");
    await save("terminal.json", terminal);
    const summary = summarizeHealth(terminal);
    await save("verification.json", summary);
    await save("player-transcript.json", {
      source: "automated-native-client",
      messages,
    });
    await frozen.check();
    return { ...summary, container: server.info.containerId };
  } catch (error) {
    await save("failure.json", {
      kind: "controlled-route-diagnostic",
      humanDemonstration: false,
      retries: 0,
      message: error instanceof Error ? error.message : String(error),
    });
    if (player !== undefined && rcon !== undefined)
      await save(
        "body-failure-state.json",
        await bodyFailureState(player, rcon),
      );
    throw error;
  } finally {
    player?.clearControlStates();
    try {
      if (player !== undefined) await disconnectBot(player);
    } finally {
      try {
        if (server !== undefined)
          await Bun.write(
            path.join(directory, "server.log"),
            await serverLogs(server.info),
          );
      } finally {
        rcon?.close();
        try {
          await server?.stop();
        } finally {
          await brain.stop();
        }
      }
    }
  }
}

/** Read only the subject's vulnerability fields after a failed private diagnostic. */
async function bodyFailureState(player: Client, rcon: RconClient) {
  const fields: Record<string, string> = {};
  try {
    for (const field of [
      "Health",
      "Invulnerable",
      "playerGameType",
      "abilities.invulnerable",
      "abilities.flying",
      "abilities.mayfly",
    ])
      fields[field] = await rcon.command(
        `data get entity RwfHealthProof ${field}`,
      );
  } catch (error) {
    fields["readFailure"] =
      error instanceof Error ? error.message : String(error);
  }
  return { clientGameMode: player.game.gameMode, fields };
}

async function prepareNavigation(
  frozen: ConversionInputs,
  staged: Awaited<ReturnType<typeof stageMap>>,
  directory: string,
) {
  const lobby = path.join(staged.content, "rwf/lobby");
  for (const [action, folder] of [
    ["bake", staged.selected],
    ["verify", staged.selected],
    ["bake-lobby", lobby],
    ["verify-lobby", lobby],
  ] as const) {
    const child = Bun.spawn(
      [
        "mise",
        "exec",
        "--",
        path.join(frozen.mapTool, "bin/rwfmap"),
        action,
        folder,
      ],
      {
        stdout: Bun.file(path.join(directory, `${action}.log`)),
        stderr: "pipe",
      },
    );
    const stderr = await new Response(child.stderr).text();
    if ((await child.exited) !== 0)
      throw new Error(`Private health map ${action} failed: ${stderr}`);
  }
}

async function wait(
  command: (request: string) => Promise<State>,
  condition: (state: State) => boolean,
  description: string,
) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const value = await command("status");
    if (value.state === "failed")
      throw new Error(`Native health fixture failed: ${description}`);
    if (condition(value)) return value;
    await Bun.sleep(100);
  }
  throw new Error(`Native health deadline: ${description}`);
}

async function drive(
  scenario: Scenario,
  player: Client,
  command: (request: string) => Promise<State>,
) {
  for (let attempt = 0; attempt <= scenario.maximumDrops; attempt++) {
    player.clearControlStates();
    const placed = await command("place");
    if (placed.state === "refused") return;
    if (attempt === scenario.maximumDrops)
      throw new Error(
        "Last bounded drop still affordable; refusal was not established",
      );
    const previousFalls = placed.falls.length;
    await player.look(-Math.PI / 2, 0, true);
    player.setControlState("forward", true);
    player.setControlState("sprint", scenario.kit === "juggernaut");
    await wait(
      command,
      (value) => (value.samples.at(-1)?.position[0] ?? 0) >= 23.3,
      "actual walk-off",
    );
    player.clearControlStates();
    await wait(
      command,
      (value) => {
        const last = value.samples.at(-1);
        return (
          last !== undefined &&
          last.position[1] < 68.5 &&
          (scenario.landing === "water"
            ? last.inWater
            : last.onGround && value.falls.length > previousFalls)
        );
      },
      "native landing and deferred FALL observation",
    );
    if (scenario.mode === "single") return;
    if (scenario.mode === "protection-expiry") {
      if (attempt === 1) return;
      await wait(
        command,
        (value) =>
          value.samples.at(-1)?.traversal.resistanceUntilTick === -1 &&
          value.setups.some((setup) => setup.kind === "effect-expired"),
        "actual resistance expiry",
      );
    }
  }
  throw new Error(
    "Health case failed to establish its bounded terminal condition",
  );
}
