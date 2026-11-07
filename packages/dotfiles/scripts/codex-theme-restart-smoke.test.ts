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

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

const mockHc = String.raw`#!/usr/bin/env bun
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
const home = process.env.HOME;
for (const key of ['OP_SERVICE_ACCOUNT_TOKEN', 'OPENAI_API_KEY', 'CODEX_THREAD_ID', 'HC_TERMINAL_ID', 'HC_TERMINAL_SOCKET', 'HC_SESSION']) {
  if (process.env[key] !== undefined) process.exit(42);
}
const args = process.argv.slice(2);
appendFileSync(home + '/calls', JSON.stringify(args) + '\n');
if (args[0] === 'ls') {
  if (existsSync(home + '/delay')) await Bun.sleep(Number(readFileSync(home + '/delay', 'utf8')));
  console.log(JSON.stringify({terminals: [
    {address: 't1', agent: 'claude-code', state: 'live'}, {address: 'desktop/t2', agent: 'codex', state: 'live'}
  ]}));
} else process.exit(43);
`;
const mockAppearance = `#!/usr/bin/env bun
console.log(await Bun.file(process.env.HOME + '/mode').text());
`;
const mockLogger = String.raw`#!/usr/bin/env bun
import { appendFileSync } from 'node:fs';
appendFileSync(process.env.HOME + '/logger-calls', JSON.stringify(process.argv.slice(2)) + '\n');
`;

async function fixture() {
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
      )
      .replace(
        '"/usr/bin/logger"',
        JSON.stringify(path.join(directory, "logger")),
      ),
  );
  for (const name of [
    "codex_theme_restart_launch.ts",
    "codex_theme_restart_core.ts",
    "codex_theme_restart_options.ts",
    "codex_theme_restart_status.ts",
    "codex_theme_restart_terminal.ts",
    "codex_theme_restart_config.ts",
    "codex_theme_restart_events.ts",
  ]) {
    await writeFile(
      path.join(directory, name),
      await readFile(path.resolve(import.meta.dir, "../bin", name)),
    );
  }
  await writeFile(path.join(directory, "mode"), "light");
  // The worker runs hc by absolute path under HOME, not through PATH.
  await mkdir(path.join(directory, ".local/bin"), { recursive: true });
  await writeFile(path.join(directory, ".local/bin/hc"), mockHc);
  await writeFile(path.join(directory, "dark-notify"), mockAppearance);
  await writeFile(path.join(directory, "logger"), mockLogger);
  for (const file of [".local/bin/hc", "dark-notify", "logger"])
    await chmod(path.join(directory, file), 0o700);
  const stateDirectory = path.join(
    directory,
    ".local/state/codex-theme-restart",
  );
  const state = path.join(stateDirectory, "appearance.json");
  const events = path.join(stateDirectory, "events.jsonl");
  function start(args: string[]) {
    return Bun.spawn([process.execPath, helper, ...args], {
      env: {
        HOME: directory,
        PATH: `${directory}:${Bun.env["PATH"] ?? "/usr/bin:/bin"}`,
        OP_SERVICE_ACCOUNT_TOKEN: "test-sentinel",
        OPENAI_API_KEY: "test-sentinel",
        CODEX_THREAD_ID: "test-sentinel",
        HC_TERMINAL_ID: "test-sentinel",
        HC_TERMINAL_SOCKET: "test-sentinel",
        HC_SESSION: "test-sentinel",
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
  async function lines(file: string): Promise<unknown[]> {
    if (!(await Bun.file(file).exists())) return [];
    const contents = await readFile(file, "utf8");
    return contents
      .trim()
      .split("\n")
      .map((line): unknown => JSON.parse(line));
  }
  return {
    directory,
    stateDirectory,
    state,
    start,
    run,
    calls,
    events: () => lines(events),
    logged: () => lines(path.join(directory, "logger-calls")),
  };
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

test("initializes without restart, deduplicates events, and scans live local terminals once", async () => {
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
  expect(await context.calls()).toEqual([["ls", "--json"]]);
  expect(JSON.parse(await readFile(context.state, "utf8"))).toEqual({
    appearance: "dark",
  });
  expect(await context.events()).toMatchObject([
    { trigger: "on-change", action: "initialized", ok: true, mode: "light" },
    { trigger: "on-change", action: "unchanged", ok: true },
    {
      trigger: "on-change",
      action: "restart",
      ok: true,
      error: null,
      previous: "light",
      mode: "dark",
      theme: "catppuccin-mocha",
      panes: [],
    },
  ]);
  const logged = await context.logged();
  expect(logged.at(-1)).toEqual([
    "-t",
    "codex-theme-restart",
    "-p",
    "user.notice",
    "codex-theme-restart: on-change; ok; appearance light -> dark; theme catppuccin-mocha; 0 restarted, 0 eligible, 0 identified, 0 skipped, 0 failed",
  ]);
  expect(await context.run(["--worker", "--on-change"])).toMatchObject({
    code: 0,
    stdout: expect.stringContaining("Appearance remains dark"),
  });
  expect(await context.calls()).toHaveLength(1);
});

test("dry-run creates no state directory and sends only discovery commands", async () => {
  const context = await fixture();
  expect(await context.run(["--dry-run"])).toMatchObject({ code: 0 });
  await expect(stat(context.stateDirectory)).rejects.toMatchObject({
    code: "ENOENT",
  });
  expect(await context.logged()).toEqual([]);
  expect(await context.calls()).toEqual([["ls", "--json"]]);
});

test("a thrown error is recorded as a failed event and mirrored to the unified log", async () => {
  const context = await fixture();
  await writeFile(path.join(context.directory, "mode"), "purple");
  expect(await context.run(["--worker", "--on-change"])).toMatchObject({
    code: 1,
    stderr: expect.stringContaining("invalid appearance"),
  });
  expect(await context.calls()).toEqual([]);
  expect(await Bun.file(context.state).exists()).toBe(false);
  expect(await context.events()).toMatchObject([
    {
      trigger: "on-change",
      ok: false,
      mode: null,
      error: "dark-notify returned an invalid appearance",
    },
  ]);
  expect(await context.logged()).toEqual([
    [
      "-t",
      "codex-theme-restart",
      "-p",
      "user.err",
      "codex-theme-restart: on-change; FAILED; appearance unrecorded -> unknown; error: dark-notify returned an invalid appearance",
    ],
  ]);
});

test("records a failed pane when hc is unavailable", async () => {
  const context = await fixture();
  await rm(path.join(context.directory, ".local/bin/hc"));
  expect(await context.run(["--worker"])).toMatchObject({ code: 1 });
  const [recorded] = await context.events();
  expect(recorded).toMatchObject({
    trigger: "manual",
    action: "restart",
    ok: false,
    counts: { failed: 1 },
    panes: [{ terminal: "*", status: "failed" }],
  });
  const logged = await context.logged();
  expect(logged).toEqual([
    [
      "-t",
      "codex-theme-restart",
      "-p",
      "user.err",
      "codex-theme-restart: manual; FAILED; appearance unrecorded -> light; theme catppuccin-latte; 0 restarted, 0 eligible, 0 identified, 0 skipped, 1 failed",
    ],
    [
      "-t",
      "codex-theme-restart",
      "-p",
      "user.err",
      expect.stringMatching(/^codex-theme-restart: failed \*: /),
    ],
  ]);
});

test("status reports the last run and appearance without writing anything", async () => {
  const context = await fixture();
  expect(await context.run(["--status"])).toMatchObject({
    code: 1,
    stdout: expect.stringContaining(
      "Appearance: recorded unrecorded, current light MISMATCH",
    ),
  });
  await context.run(["--worker", "--on-change"]);
  const before = await context.events();
  const report = await context.run(["--status"]);
  expect(report).toMatchObject({ code: 0 });
  expect(report.stdout).toContain("Last run: ");
  expect(report.stdout).toContain("Local Codex terminals: none");
  expect(await context.events()).toEqual(before);
  expect(await context.logged()).toHaveLength(1);
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
  expect(await context.calls()).toHaveLength(1);
});

test("releases the lock after a worker crash without a stale PID file", async () => {
  const context = await fixture();
  await writeFile(path.join(context.directory, "delay"), "300");
  const first = context.start(["--worker"]);
  await waitFor(() => Bun.file(path.join(context.directory, "calls")).exists());
  first.kill("SIGKILL");
  await finish(first);
  expect(await context.run(["--worker"])).toMatchObject({ code: 0 });
  expect(await context.calls()).toHaveLength(2);
});

test("launches a detached worker with scrubbed credentials and reports its eventual result", async () => {
  const context = await fixture();
  const launched = await context.run(["--terminal", "t5"]);
  expect(launched.code).toBe(0);
  expect(launched.stdout).toContain("Restart worker");
  await waitFor(async () => {
    const recorded = await context.events();
    return recorded.length > 0;
  });
  expect(await context.events()).toMatchObject([
    { trigger: "manual", terminal: "t5", action: "restart", ok: false },
  ]);
  expect(await context.calls()).toEqual([["ls", "--json"]]);
});

test("corrupt appearance state fails loudly before any terminal operation", async () => {
  const context = await fixture();
  await context.run(["--worker", "--on-change"]);
  await writeFile(context.state, '{"appearance":"invalid"}');
  expect(await context.run(["--worker", "--on-change"])).toMatchObject({
    code: 1,
    stderr: expect.stringContaining("Invalid appearance state"),
  });
  expect(await context.calls()).toEqual([]);
});
