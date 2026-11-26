import {
  chmod,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import {
  runner,
  startMacBackground,
  type Launchd,
  type LaunchctlResult,
} from "../bin/herdr_worktree_pool_launchd.ts";

const now = 1_700_000_000_000;
const done: LaunchctlResult = { code: 0, stdout: "", stderr: "" };

function permissions(entry: { mode: number }): number {
  return entry.mode & 0o777;
}

const label = (age: number) =>
  `com.jerred.herdr-worktree.job.${String(now - age)}-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa`;

function fakeLaunchd(
  options: {
    bootstrap?: LaunchctlResult;
    listing?: string;
    overrides?: Partial<Launchd>;
  } = {},
) {
  const calls: string[][] = [];
  const errors: string[] = [];
  const plists: { file: string; text: string; mode: number }[] = [];
  const directories: { path: string; mode: number }[] = [];
  const launchd: Launchd = {
    platform: "darwin",
    uid: 501,
    home: "/Users/test",
    path: "/opt/homebrew/bin:/usr/bin",
    now: () => now,
    async launchctl(args) {
      calls.push([...args]);
      if (args[0] === "list")
        return { ...done, stdout: options.listing ?? "PID\tStatus\tLabel\n" };
      if (args[0] === "bootstrap") {
        const file = String(args[2]);
        plists.push({
          file,
          text: await readFile(file, "utf8"),
          mode: permissions(await stat(file)),
        });
        const folder = path.dirname(file);
        directories.push({
          path: folder,
          mode: permissions(await stat(folder)),
        });
        return options.bootstrap ?? done;
      }
      return done;
    },
    logError: (message) => errors.push(message),
    ...options.overrides,
  };
  return { launchd, calls, errors, plists, directories };
}

async function exists(file: string): Promise<boolean> {
  return Bun.file(file).exists();
}

test("a job goes to the user's domain with only HOME and PATH, and no secret reaches its plist", async () => {
  const secrets = {
    OP_SERVICE_ACCOUNT_TOKEN: "ops_secret_token_value",
    OPENAI_API_KEY: "sk-secret-api-key-value",
    GH_TOKEN: "ghp_secret_token_value",
    HERDR_WORKTREE_REQUEST: '{"message":"secret request text"}',
  };
  const saved = Object.entries(secrets).map(
    ([key]) => [key, Bun.env[key]] as const,
  );
  Object.assign(Bun.env, secrets);
  const fake = fakeLaunchd();
  try {
    const job = await startMacBackground(
      "/work tree/it's",
      ["/Users/test/.local/bin/toolkit", "tend", "dedupe", "--apply"],
      fake.launchd,
    );
    expect(job).toMatch(
      /^com\.jerred\.herdr-worktree\.job\.1700000000000-[\da-f-]{36}$/,
    );
    const [plist] = fake.plists;
    if (plist === undefined) throw new Error("launchctl never saw the plist");
    for (const value of Object.values(secrets))
      expect(plist.text).not.toContain(value);
    expect(plist.text).not.toMatch(/TOKEN|API_KEY|SECRET|PASSWORD/i);
    expect(plist.text).not.toContain("EnvironmentVariables");
    // env -i leaves exactly these two variables for the job.
    expect(plist.text).toContain(
      "<string>/usr/bin/env</string><string>-i</string>",
    );
    expect(plist.text).toContain(
      "<string>HOME=/Users/test</string><string>PATH=/opt/homebrew/bin:/usr/bin</string><string>/bin/sh</string>",
    );
    expect(plist.text).toContain("<key>RunAtLoad</key><true/>");
    expect(plist.text).toContain(
      "<key>StandardOutPath</key><string>/dev/null</string>",
    );
    expect(plist.text).toContain(
      "<key>StandardErrorPath</key><string>/dev/null</string>",
    );
    expect(plist.text).toContain(
      `<string>gui/501/${job}</string><string>/work tree/it's</string><string>/Users/test/.local/bin/toolkit</string>`,
    );
    expect(plist.mode).toBe(0o600);
    const [folder] = fake.directories;
    expect(folder?.mode).toBe(0o700);
    expect(fake.calls.at(-1)).toEqual(["bootstrap", "gui/501", plist.file]);
    // launchd read the plist at bootstrap, so nothing is left behind.
    expect(await exists(plist.file)).toBe(false);
    expect(await exists(path.dirname(plist.file))).toBe(false);
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) Reflect.deleteProperty(Bun.env, key);
      else Bun.env[key] = value;
    }
  }
});

test("a refused submission throws, is logged, and leaves no plist behind", async () => {
  const fake = fakeLaunchd({
    bootstrap: {
      code: 5,
      stdout: "",
      stderr: "Bootstrap failed: 5: Input/output error\n",
    },
  });
  await expect(
    startMacBackground("/work", ["/bin/true"], fake.launchd),
  ).rejects.toThrow(
    "Could not submit macOS background job: Bootstrap failed: 5: Input/output error",
  );
  expect(fake.errors).toEqual([
    "Could not submit macOS background job: Bootstrap failed: 5: Input/output error",
  ]);
  const [plist] = fake.plists;
  if (plist === undefined) throw new Error("launchctl never saw the plist");
  expect(await exists(path.dirname(plist.file))).toBe(false);
  // No login domain at all is the same refusal, before anything is written.
  const noLogin = fakeLaunchd({ overrides: { uid: undefined } });
  await expect(
    startMacBackground("/work", ["/bin/true"], noLogin.launchd),
  ).rejects.toThrow("A macOS user login domain is required.");
  const linux = fakeLaunchd({ overrides: { platform: "linux" } });
  await expect(
    startMacBackground("/work", ["/bin/true"], linux.launchd),
  ).rejects.toThrow("A macOS user login domain is required.");
  expect(noLogin.calls).toEqual([]);
  expect(linux.calls).toEqual([]);
});

test("finished jobs that are old enough are unloaded before a new one is submitted", async () => {
  const hour = 3_600_000;
  const fake = fakeLaunchd({
    listing: [
      "PID\tStatus\tLabel",
      `-\t0\t${label(hour)}`, // killed before it could unload itself
      `4242\t0\t${label(hour)}`, // old but still running: left alone
      `-\t0\t${label(1000)}`, // may still be starting: left alone
      "-\t0\tcom.jerred.herdr-worktree-pool", // not a one-shot job
      "-\t0\tcom.apple.something",
    ].join("\n"),
  });
  await startMacBackground("/work", ["/bin/true"], fake.launchd);
  const bootouts = fake.calls.filter((call) => call[0] === "bootout");
  expect(bootouts).toEqual([["bootout", `gui/501/${label(hour)}`]]);
  expect(fake.errors).toEqual([`Unloaded stale background job ${label(hour)}`]);
  expect(fake.calls.at(-1)?.[0]).toBe("bootstrap");
});

async function runRunner(command: string[], signalShellAfterMs?: number) {
  const directory = await mkdtemp(path.join(tmpdir(), "herdr-runner-"));
  const record = path.join(directory, "launchctl-calls");
  const fakeLaunchctl = path.join(directory, "launchctl");
  await writeFile(fakeLaunchctl, `#!/bin/sh\necho "$@" >> '${record}'\n`);
  await chmod(fakeLaunchctl, 0o755);
  const child = Bun.spawn(
    [
      "/bin/sh",
      "-c",
      runner,
      "job-label",
      fakeLaunchctl,
      "gui/501/job-label",
      directory,
      ...command,
    ],
    { stdin: "ignore", stdout: "ignore", stderr: "ignore" },
  );
  if (signalShellAfterMs !== undefined) {
    // As `launchctl kill` does: the signal goes to the job's shell alone.
    await Bun.sleep(signalShellAfterMs);
    child.kill("SIGTERM");
  }
  const code = await child.exited;
  const calls = (await exists(record)) ? await readFile(record, "utf8") : "";
  await rm(directory, { recursive: true, force: true });
  return { code, calls };
}

test("a job unloads itself when its command succeeds, fails, or is signalled", async () => {
  const succeeded = await runRunner(["/bin/sh", "-c", "exit 0"]);
  expect(succeeded.code).toBe(0);
  expect(succeeded.calls).toBe("bootout gui/501/job-label\n");
  const failed = await runRunner(["/bin/sh", "-c", "exit 7"]);
  expect(failed.code).toBe(7);
  expect(failed.calls).toBe("bootout gui/501/job-label\n");
  // The command signals its parent shell, as launchd does when it stops a job.
  const signalled = await runRunner([
    "/bin/sh",
    "-c",
    "kill -TERM $PPID; sleep 1",
  ]);
  expect(signalled.code).toBe(143);
  expect(signalled.calls).toBe("bootout gui/501/job-label\n");
  const started = Date.now();
  const stopped = await runRunner(["/bin/sleep", "30"], 500);
  expect(stopped.code).toBe(143);
  expect(stopped.calls).toBe("bootout gui/501/job-label\n");
  expect(Date.now() - started).toBeLessThan(15_000);
  const missing = await runRunner(["/nonexistent/command"]);
  expect(missing.code).not.toBe(0);
  expect(missing.calls).toBe("bootout gui/501/job-label\n");
}, 30_000);
