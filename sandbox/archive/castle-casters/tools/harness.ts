import { join, delimiter } from "node:path";
import { mkdir } from "node:fs/promises";
import { writeFileSync } from "node:fs";
import assert from "node:assert/strict";

const root = join(import.meta.dir, "..");
const output = join(root, "target", "harness-artifacts");
await mkdir(output, { recursive: true });
const hidden = Bun.argv.includes("--hidden");
type Turn = {
  type: string;
  seat: number;
  x: number;
  y: number;
  pivotX: number;
  pivotY: number;
};
type State = {
  scene: string;
  settled: boolean;
  animation: number;
  canTurn: boolean;
  feedback: string;
  mode: string;
  vertical: boolean;
  moves: Turn[];
  session?: {
    revision: number;
    phase: string;
    match?: {
      activePlayer: number;
      winner: number;
      pawns: { seat: number; x: number; y: number }[];
      walls: { x: number; y: number; vertical: boolean }[];
    };
    seats: { number: number; controller: string; connected: boolean }[];
  };
  controls: Record<
    string,
    { x: number; y: number; w: number; h: number; enabled: boolean }
  >;
  board: { x: number; y: number; tile: number; grid: number };
  viewport: {
    width: number;
    height: number;
    framebufferWidth: number;
    framebufferHeight: number;
  };
};
async function run(command: string[]) {
  const args =
    process.platform === "win32" && command[0] === "mvn"
      ? ["cmd.exe", "/d", "/c", "mvn.cmd", ...command.slice(1)]
      : command;
  const child = Bun.spawn(args, {
    cwd: root,
    stdout: "inherit",
    stderr: "inherit",
  });
  if ((await child.exited) !== 0) throw new Error(`Failed: ${command[0]}`);
}
if (!Bun.argv.includes("--no-build"))
  await run([
    "mvn",
    "test-compile",
    "dependency:build-classpath",
    "-Dmdep.outputFile=target/harness-classpath",
  ]);
const classpath = [
  join(root, "target/classes"),
  join(root, "target/test-classes"),
  (await Bun.file(join(root, "target/harness-classpath")).text()).trim(),
].join(delimiter);
const applications: App[] = [];
class App {
  running = false;
  readonly base: string;
  readonly process: ReturnType<typeof Bun.spawn>;
  constructor(readonly port: number) {
    this.base = `http://127.0.0.1:${port}`;
    // Spawn's file redirection can leave a previous run's tail in a shorter log.
    for (const name of [`${port}.log`, `${port}-error.log`])
      writeFileSync(join(output, name), "");
    this.process = Bun.spawn(
      [
        "java",
        ...(process.platform === "darwin" ? ["-XstartOnFirstThread"] : []),
        "--enable-native-access=ALL-UNNAMED",
        "-cp",
        classpath,
        "com.shepherdjerred.castlecasters.harness.HarnessMain",
        String(port),
        "manual",
        ...(hidden ? ["hidden"] : []),
      ],
      {
        cwd: root,
        stdout: Bun.file(join(output, `${port}.log`)),
        stderr: Bun.file(join(output, `${port}-error.log`)),
      },
    );
    applications.push(this);
  }
  async request(path: string, body?: object) {
    const response = await fetch(this.base + path, {
      method: body ? "POST" : "GET",
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(12000),
    }).catch((error) => {
      throw new Error(`${this.port} ${path} failed`, { cause: error });
    });
    if (!response.ok) throw new Error(`${path}: ${await response.text()}`);
    return response;
  }
  async state(): Promise<State> {
    return (await this.request("/state")).json();
  }
  async ready() {
    const end = Date.now() + 20000;
    while (Date.now() < end) {
      if (this.process.exitCode !== null)
        throw new Error(
          "Game exited during startup; inspect harness-artifacts logs",
        );
      try {
        await this.state();
        this.running = true;
        return;
      } catch {
        await Bun.sleep(100);
      }
    }
    throw new Error("Game startup timed out");
  }
  async step(seconds = 0.5) {
    await this.request("/step", { seconds });
    await this.wait((s) => s.settled, false);
  }
  async wait(test: (state: State) => boolean, advance = true, timeout = 20000) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      const s = await this.state();
      if (test(s)) return s;
      if (advance)
        await Promise.all(
          applications
            .filter((a) => a.running)
            .map(async (a) => {
              if ((await a.state()).settled)
                await a.request("/step", { seconds: 0.1 });
            }),
        );
      await Bun.sleep(25);
    }
    throw new Error(
      `State condition timed out: ${JSON.stringify(await this.state())}`,
    );
  }
  async input(body: object) {
    await this.request("/input", body);
  }
  point(s: State, x: number, y: number) {
    const { width, height } = s.viewport,
      scale = Math.min(width / 1360, height / 768);
    return {
      x: Math.round(x * scale + (width - 1360 * scale) / 2),
      y: Math.round(y * scale + (height - 768 * scale) / 2),
      button: "LEFT",
    };
  }
  async click(id: string) {
    console.log(`${this.port}: ${id}`);
    await this.step(0.1);
    const state = await this.state(),
      control = state.controls[id];
    assert(control, `Missing control ${id}`);
    assert(control.enabled, `Disabled control ${id}`);
    const point = this.point(
      state,
      control.x + control.w / 2,
      control.y + control.h / 2,
    );
    await this.input({ type: "move", ...point });
    await this.input({ type: "down", ...point });
    await this.input({ type: "up", ...point });
    await this.step(0.1);
  }
  async capture(name: string) {
    await this.step(0.1);
    await Bun.write(
      join(output, `${name}.json`),
      JSON.stringify(await this.state(), null, 2),
    );
    await Bun.write(
      join(output, `${name}.png`),
      await (await this.request("/frame.png")).arrayBuffer(),
    );
  }
  async fixture(name: string) {
    await this.request("/scenario", { name, seed: 1 });
    await this.step(0.1);
  }
  async move(turn: Turn) {
    const s = await this.state(),
      b = s.board;
    const point = this.point(
      s,
      b.x + turn.x * b.tile + b.tile / 2,
      b.y + (16 - turn.y) * b.tile + b.tile / 2,
    );
    const revision = s.session!.revision;
    await this.input({ type: "down", ...point });
    await this.input({ type: "up", ...point });
    await this.wait((next) => next.session!.revision > revision);
  }
  async shutdown() {
    this.running = false;
    if (this.process.exitCode !== null) {
      if (this.process.exitCode !== 0)
        throw new Error(`Game exited with ${this.process.exitCode}`);
      return;
    }
    await this.request("/shutdown", {});
    const result = await Promise.race([
      this.process.exited,
      Bun.sleep(10000).then(() => {
        throw new Error("Game shutdown timed out");
      }),
    ]);
    assert.equal(result, 0, "Game shutdown must release its workers");
  }
}
function goalMove(state: State, seat: number) {
  const blocked = new Set<string>();
  for (const wall of state.session!.match!.walls)
    for (let offset = 0; offset <= 2; offset++)
      blocked.add(
        `${wall.x + (wall.vertical ? 0 : offset)},${wall.y + (wall.vertical ? offset : 0)}`,
      );
  const distance = (move: Turn) => {
    const queue = [[move.x, move.y, 0]],
      seen = new Set<string>([`${move.x},${move.y}`]);
    for (let i = 0; i < queue.length; i++) {
      const [x, y, d] = queue[i]!;
      if (
        (seat === 1 && y === 16) ||
        (seat === 2 && y === 0) ||
        (seat === 3 && x === 16) ||
        (seat === 4 && x === 0)
      )
        return d!;
      for (const [dx, dy] of [
        [0, 2],
        [0, -2],
        [2, 0],
        [-2, 0],
      ]) {
        const nx = x! + dx!,
          ny = y! + dy!,
          key = `${nx},${ny}`;
        if (
          nx < 0 ||
          nx > 16 ||
          ny < 0 ||
          ny > 16 ||
          seen.has(key) ||
          blocked.has(`${x! + dx! / 2},${y! + dy! / 2}`)
        )
          continue;
        seen.add(key);
        queue.push([nx, ny, d! + 1]);
      }
    }
    throw new Error("A legal position must retain a goal path");
  };
  return [...state.moves]
    .map((turn) => ({ turn, distance: distance(turn) }))
    .sort((a, b) => a.distance - b.distance)[0]!.turn;
}
try {
  const game = new App(4188);
  await game.ready();
  await game.capture("menu");
  const play = (await game.state()).controls.local!;
  const playPoint = game.point(
    await game.state(),
    play.x + play.w / 2,
    play.y + play.h / 2,
  );
  await game.input({ type: "move", ...playPoint });
  await game.capture("button-hover");
  await game.input({ type: "down", ...playPoint });
  await game.capture("button-pressed");
  await game.input({ type: "up", ...playPoint });
  assert.equal((await game.state()).scene, "lobby");
  await game.click("back");
  await game.click("help");
  assert.equal((await game.state()).scene, "help");
  await game.capture("how-to-play");
  await game.click("back");
  assert.equal((await game.state()).scene, "menu");
  await game.click("help");
  await game.input({ type: "keyDown", key: "ESCAPE" });
  assert.equal((await game.state()).scene, "menu");
  await game.request("/resize", { width: 1000, height: 650 });
  await game.wait(
    (s) => s.viewport.width === 1000 && s.viewport.height === 650,
  );
  await game.click("local");
  await game.click("seat1name");
  await game.input({ type: "text", text: " resized" });
  await game.input({ type: "keyDown", key: "ENTER" });
  await game.click("start");
  await game.move((await game.state()).moves.find((m) => m.y === 2)!);
  await game.capture("resized-input");
  await game.request("/resize", { width: 1360, height: 768 });
  await game.wait(
    (s) => s.viewport.width === 1360 && s.viewport.height === 768,
  );
  for (const count of [2, 4]) {
    await game.fixture(`lobby${count}`);
    await game.capture(`lobby-${count}`);
    await game.fixture(`board${count}`);
    await game.capture(`board-${count}`);
    const before = await game.state();
    await game.move(before.moves.find((m) => m.x === 8 && m.y === 2)!);
    await game.capture(`moving-${count}`);
    await game.wait((s) => s.animation === 0);
    assert.equal((await game.state()).session!.match!.activePlayer, 2);
    await game.click("wall");
    await game.input({ type: "keyDown", key: "R" });
    await game.input({ type: "move", x: 484, y: 378 });
    await game.capture(`wall-preview-${count}`);
    const rev = (await game.state()).session!.revision;
    await game.input({ type: "up", button: "LEFT", x: 484, y: 378 });
    await game.wait((s) => s.session!.revision > rev);
    assert.equal((await game.state()).session!.match!.walls.length, 1);
    await game.capture(`cast-${count}`);
    await game.wait((s) => s.animation === 0);
    await game.capture(`wall-${count}`);
  }
  for (const fixture of ["jump", "diagonal", "near-victory"]) {
    await game.fixture(fixture);
    const state = await game.state();
    const move = state.moves.find((m) =>
      fixture === "jump"
        ? m.type === "JUMP"
        : fixture === "diagonal"
          ? m.type === "DIAGONAL"
          : m.y === 16,
    )!;
    assert(move);
    await game.move(move);
    await game.wait((s) => s.animation === 0);
    await game.capture(fixture);
    if (fixture !== "jump") {
      assert.equal((await game.state()).session!.phase, "FINISHED");
      await game.click("rematch");
      assert.equal((await game.state()).scene, "lobby");
    }
  }
  await game.fixture("menu");
  await game.click("local");
  // Render both alternative original maps through the lobby controls.
  for (const theme of ["DESERT", "WINTER"]) {
    await game.click("theme");
    await game.click("start");
    await game.capture(`map-${theme.toLowerCase()}`);
    await game.click("back");
    await game.click("local");
    if (theme === "DESERT") await game.click("theme");
  }
  await game.click("start");
  await game.move((await game.state()).moves.find((m) => m.y === 2)!);
  await game.wait(
    (s) => s.session!.match!.activePlayer === 1 && s.animation === 0,
  );
  await game.capture("single-player-ai");
  for (let turn = 0; turn < 200; turn++) {
    const state = await game.wait(
      (s) => s.session!.phase === "FINISHED" || s.canTurn,
    );
    if (state.session!.phase === "FINISHED") break;
    await game.move(goalMove(state, state.session!.match!.activePlayer));
  }
  assert.equal((await game.state()).session!.phase, "FINISHED");
  await game.wait((s) => s.animation === 0);
  await game.capture("single-player-victory");
  await game.click("back");
  // Drive a real host and three native client windows through the same UI.
  await game.click("host");
  await game.click("count");
  for (const seat of [3, 4]) {
    await game.click(`seat${seat}controller`);
  }
  const clients = [];
  for (const port of [4189, 4190, 4191]) {
    const remote = new App(port);
    await remote.ready();
    await remote.click("join");
    await remote.click("name");
    for (let i = 0; i < 3; i++)
      await remote.input({ type: "keyDown", key: "BACKSPACE" });
    await remote.input({ type: "text", text: `Guest ${port - 4187}` });
    await remote.click("connect");
    clients.push(remote);
    await Promise.all([
      game.wait(
        (s) =>
          s.session!.seats.filter(
            (p) => p.connected && p.controller === "REMOTE",
          ).length === clients.length,
      ),
      remote.wait((s) => Boolean(s.session)),
    ]);
  }
  await game.capture("network-lobby-four");
  await game.click("start");
  for (const remote of clients) await remote.wait((s) => s.scene === "game");
  // A complete four-player game using shortest legal moves, all over real UI/socket paths.
  for (let turn = 0; turn < 160; turn++) {
    let s = await game.wait((s) => s.animation === 0);
    if (s.session!.phase === "FINISHED") break;
    const active = s.session!.match!.activePlayer;
    const player = active === 1 ? game : clients[active - 2]!;
    s = await player.wait(
      (s) => s.canTurn && s.session!.match!.activePlayer === active,
    );
    const turnData = goalMove(s, active);
    await player.move(turnData);
    await game.wait((h) => h.session!.revision > s.session!.revision);
  }
  assert.equal((await game.state()).session!.phase, "FINISHED");
  await game.wait((s) => s.animation === 0);
  await game.capture("network-victory-four");
  await game.click("rematch");
  await game.click("start");
  await clients[0]!.request("/disconnect", {});
  await game.wait((s) => s.session!.phase === "PAUSED");
  await game.capture("network-paused");
  await game.wait((s) => s.session!.phase === "PLAYING");
  await clients[0]!.wait((s) => s.session!.phase === "PLAYING");
  await game.capture("network-rejoined");
  await game.click("back");
  for (const remote of clients)
    await remote.wait((s) => s.session!.phase === "CLOSED");
  await clients[0]!.capture("network-host-ended");
  await Bun.write(
    join(output, "acceptance.json"),
    JSON.stringify(
      {
        platform: process.platform,
        arch: process.arch,
        hidden,
        passed: true,
        flows: [
          "two/four local",
          "button hover/press and help navigation",
          "wall previews and placement",
          "jumps",
          "victory/rematch",
          "single player AI",
          "complete single player game",
          "resized input and all maps",
          "four-player network game",
          "pause/rejoin",
          "host departure",
        ],
      },
      null,
      2,
    ),
  );
  console.log(`Native acceptance passed. Evidence: ${output}`);
} finally {
  const results = await Promise.allSettled(
    applications.map((app) => app.shutdown()),
  );
  for (let i = 0; i < results.length; i++)
    if (results[i]!.status === "rejected") {
      applications[i]!.process.kill();
      console.error(results[i]);
      process.exitCode = 1;
    }
}
