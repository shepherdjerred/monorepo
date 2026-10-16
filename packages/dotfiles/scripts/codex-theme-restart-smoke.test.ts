import { afterEach, expect, test } from "vitest";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { object } from "../bin/codex_theme_restart_core.ts";

const directories: string[] = [];
const stopServers: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(stopServers.splice(0).map((stop) => stop()));
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

const mockHerdr = String.raw`#!/usr/bin/env bun
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
const home = process.env.HOME;
for (const key of ['OP_SERVICE_ACCOUNT_TOKEN', 'OPENAI_API_KEY', 'CODEX_THREAD_ID', 'HERDR_SOCKET_PATH']) {
  if (process.env[key] !== undefined) process.exit(42);
}
const args = process.argv.slice(2);
appendFileSync(home + '/calls', JSON.stringify(args) + '\n');
if (args[0] === 'session') {
  if (existsSync(home + '/delay')) await Bun.sleep(Number(readFileSync(home + '/delay', 'utf8')));
  console.log(JSON.stringify({sessions: [
    {name: 'default', running: true}, {name: 'other', running: true}, {name: 'stopped', running: false}
  ]}));
} else if (args[2] === 'agent' && args[3] === 'list') {
  console.log(JSON.stringify({result: {agents: []}}));
} else process.exit(43);
`;
const mockAppearance = `#!/usr/bin/env bun
console.log(await Bun.file(process.env.HOME + '/mode').text());
`;

async function fixture(configStatus = "ok") {
  // Unix socket paths must remain shorter than macOS's sockaddr_un limit.
  const directory = await mkdtemp("/tmp/codex-theme-smoke-");
  directories.push(directory);
  const helper = path.join(directory, "restart.ts");
  // Exercise the real launcher, SQLite lock, state, and detached worker on every
  // CI host; replace only the platform check and fixed macOS appearance command.
  const source = await readFile(
    path.resolve(import.meta.dir, "../bin/executable_restart_codex_panes.ts"),
    "utf8",
  );
  await writeFile(
    helper,
    source
      .replace(
        'process.platform !== "darwin"',
        'process.platform === "unsupported-test-platform"',
      )
      .replace(
        '"/opt/homebrew/bin/dark-notify"',
        JSON.stringify(path.join(directory, "dark-notify")),
      ),
  );
  for (const name of [
    "codex_theme_restart_launch.ts",
    "codex_theme_restart_core.ts",
    "codex_theme_restart_options.ts",
    "codex_theme_restart_status.ts",
    "codex_theme_restart_config.ts",
  ]) {
    await writeFile(
      path.join(directory, name),
      await readFile(path.resolve(import.meta.dir, "../bin", name)),
    );
  }
  await writeFile(path.join(directory, "mode"), "light");
  await writeFile(path.join(directory, "herdr"), mockHerdr);
  await writeFile(path.join(directory, "dark-notify"), mockAppearance);
  await chmod(path.join(directory, "herdr"), 0o700);
  await chmod(path.join(directory, "dark-notify"), 0o700);
  const control = path.join(directory, ".codex/app-server-control");
  await mkdir(control, { recursive: true });
  const server = Bun.serve({
    unix: path.join(control, "app-server-control.sock"),
    fetch(request, instance) {
      if (instance.upgrade(request)) return;
      return new Response("WebSocket required", { status: 400 });
    },
    websocket: {
      async message(socket, data) {
        const request = object(JSON.parse(String(data)));
        if (request.get("id") === 1)
          socket.send(JSON.stringify({ id: 1, result: {} }));
        if (request.get("id") === 2) {
          await writeFile(
            path.join(directory, "config-edits.json"),
            JSON.stringify(object(request.get("params")).get("edits")),
          );
          socket.send(
            JSON.stringify({ id: 2, result: { status: configStatus } }),
          );
        }
      },
    },
  });
  stopServers.push(async () => {
    await server.stop(true);
  });
  const stateDirectory = path.join(
    directory,
    ".local/state/codex-theme-restart",
  );
  const state = path.join(stateDirectory, "appearance.json");
  function start(args: string[]) {
    return Bun.spawn([process.execPath, helper, ...args], {
      env: {
        HOME: directory,
        PATH: `${directory}:${Bun.env["PATH"] ?? "/usr/bin:/bin"}`,
        OP_SERVICE_ACCOUNT_TOKEN: "test-sentinel",
        OPENAI_API_KEY: "test-sentinel",
        CODEX_THREAD_ID: "test-sentinel",
        HERDR_SOCKET_PATH: "test-sentinel",
      },
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
  }
  async function run(args: string[]) {
    return finish(start(args));
  }
  async function calls(): Promise<unknown[]> {
    if (!(await Bun.file(path.join(directory, "calls")).exists())) return [];
    const contents = await readFile(path.join(directory, "calls"), "utf8");
    return contents
      .trim()
      .split("\n")
      .map((line): unknown => JSON.parse(line));
  }
  return { directory, stateDirectory, state, start, run, calls };
}

async function finish(child: Bun.Subprocess<"ignore", "pipe", "pipe">) {
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { stdout, stderr, code };
}

async function waitFor(check: () => boolean | Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 3000;
  while (!(await check())) {
    if (Date.now() >= deadline)
      throw new Error("Fixture did not reach expected state");
    await Bun.sleep(20);
  }
}

test("initializes without restart, deduplicates events, and traverses only running local sessions", async () => {
  const context = await fixture();
  expect(await context.run(["--worker", "--on-change"])).toMatchObject({
    code: 0,
    stdout: expect.stringContaining("Initialized light"),
  });
  expect(await context.run(["--worker", "--on-change"])).toMatchObject({
    code: 0,
    stdout: expect.stringContaining("Appearance remains light"),
  });
  expect(await context.calls()).toEqual([]);
  await writeFile(path.join(context.directory, "mode"), "dark");
  expect(await context.run(["--worker", "--on-change"])).toMatchObject({
    code: 0,
    stdout: expect.stringContaining("Appearance dark"),
  });
  expect(await context.calls()).toEqual([
    ["session", "list", "--json"],
    ["--session", "default", "agent", "list"],
    ["--session", "other", "agent", "list"],
  ]);
  expect(JSON.parse(await readFile(context.state, "utf8"))).toEqual({
    appearance: "dark",
  });
  expect(
    JSON.parse(
      await readFile(path.join(context.directory, "config-edits.json"), "utf8"),
    ),
  ).toEqual([
    {
      keyPath: "tui.theme",
      value: "catppuccin-mocha",
      mergeStrategy: "replace",
    },
    { keyPath: "tui.resume_cwd", value: "session", mergeStrategy: "replace" },
  ]);
  expect(await context.run(["--worker", "--on-change"])).toMatchObject({
    code: 0,
    stdout: expect.stringContaining("Appearance remains dark"),
  });
  expect(await context.calls()).toHaveLength(3);
});

test("dry-run creates no state directory and sends only discovery commands", async () => {
  const context = await fixture();
  expect(await context.run(["--dry-run"])).toMatchObject({ code: 0 });
  await expect(stat(context.stateDirectory)).rejects.toMatchObject({
    code: "ENOENT",
  });
  expect(
    await Bun.file(path.join(context.directory, "config-edits.json")).exists(),
  ).toBe(false);
  expect(await context.calls()).toEqual([
    ["session", "list", "--json"],
    ["--session", "default", "agent", "list"],
    ["--session", "other", "agent", "list"],
  ]);
});

test("requires native settings confirmation before operating on any pane", async () => {
  const context = await fixture("overridden");
  expect(await context.run(["--worker", "--session", "default"])).toMatchObject(
    {
      code: 1,
      stderr: expect.stringContaining("no clients stopped"),
    },
  );
  expect(await context.calls()).toEqual([]);
  expect(await Bun.file(context.state).exists()).toBe(false);
});

test("serializes concurrent appearance events with a real SQLite lock", async () => {
  const context = await fixture();
  await context.run(["--worker", "--on-change"]);
  await writeFile(path.join(context.directory, "mode"), "dark");
  await writeFile(path.join(context.directory, "delay"), "300");
  const first = context.start(["--worker", "--on-change"]);
  await waitFor(() => Bun.file(path.join(context.directory, "calls")).exists());
  const second = context.start(["--worker", "--on-change"]);
  const results = await Promise.all([finish(first), finish(second)]);
  expect(results.map((result) => result.code)).toEqual([0, 0]);
  expect(results[1]?.stdout).toContain("Appearance remains dark");
  expect(await context.calls()).toHaveLength(3);
});

test("releases the lock after a worker crash without a stale PID file", async () => {
  const context = await fixture();
  await writeFile(path.join(context.directory, "delay"), "300");
  const first = context.start(["--worker"]);
  await waitFor(() => Bun.file(path.join(context.directory, "calls")).exists());
  first.kill("SIGKILL");
  await finish(first);
  expect(await context.run(["--worker"])).toMatchObject({ code: 0 });
  expect(await context.calls()).toHaveLength(4);
});

test("launches a detached worker with scrubbed credentials and reports its eventual result", async () => {
  const context = await fixture();
  const launched = await context.run(["--session", "default"]);
  expect(launched.code).toBe(0);
  expect(launched.stdout).toContain("Restart worker");
  const log = path.join(context.stateDirectory, "restart.log");
  await waitFor(() => Bun.file(path.join(context.directory, "calls")).exists());
  await waitFor(
    async () => (await Bun.file(log).exists()) && Bun.file(log).size > 0,
  );
  const deadline = Date.now() + 3000;
  while (true) {
    const contents = await readFile(log, "utf8");
    if (contents.includes("0 failed")) break;
    if (Date.now() >= deadline)
      throw new Error("Detached worker did not finish");
    await Bun.sleep(20);
  }
  expect(await context.calls()).toEqual([
    ["--session", "default", "agent", "list"],
  ]);
});

test("corrupt appearance state fails loudly before any pane operation", async () => {
  const context = await fixture();
  await context.run(["--worker", "--on-change"]);
  await writeFile(context.state, '{"appearance":"invalid"}');
  expect(await context.run(["--worker", "--on-change"])).toMatchObject({
    code: 1,
    stderr: expect.stringContaining("Invalid appearance state"),
  });
  expect(await context.calls()).toEqual([]);
});
