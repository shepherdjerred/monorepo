#!/usr/bin/env bun
// Started detached by the Herdr new-worktree dialog, which closes at once:
// `herdr-new-worktree '<request json>'`. See herdr_new_worktree_core.ts.
// `herdr-new-worktree --status` prints the last runs.
import { randomUUID } from "node:crypto";
import {
  appendFile,
  chmod,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { homedir, hostname } from "node:os";
import path from "node:path";
import {
  activeRun,
  createWorktree,
  fields,
  parseRequest,
  type ExecResult,
  type Named,
  type Progress,
  type Runtime,
  type Step,
} from "./herdr_new_worktree_core.ts";

const home = homedir();
const windows = process.platform === "win32";
// Windows installs them on PATH (hc.exe under AppData\Local\Programs\herdr-core).
const hcPath = windows ? "hc" : path.join(home, ".local/bin/hc");
const herdrAppPath = windows
  ? "herdr-app"
  : path.join(home, ".local/bin/herdr-app");
// On Windows the dialog passes the request in this variable: Start-Process
// does not quote arguments, so JSON cannot go on the command line.
const requestVariable = "HERDR_WORKTREE_REQUEST";
// The mod's pure naming module, as installed: one copy of the prompt and schema.
const namingPath = path.join(
  home,
  ".config/herdr-app/mods/my-worktree/naming.js",
);
const eventsPath = path.join(home, ".local/state/herdr-worktree/events.jsonl");
const activeDir = path.join(home, ".local/state/herdr-worktree/active");
const logTag = "herdr-worktree";

function errno(error: unknown): string | null {
  if (typeof error !== "object" || error === null || !("code" in error))
    return null;
  return typeof error.code === "string" ? error.code : null;
}

function alive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return errno(error) === "EPERM";
  }
}

/** Drop leftover temp files and runs whose worker is gone. */
async function sweepActive(): Promise<void> {
  let names: string[];
  try {
    names = await readdir(activeDir);
  } catch (error) {
    if (errno(error) === "ENOENT") return;
    throw error;
  }
  await Promise.all(
    names.map(async (name) => {
      const file = path.join(activeDir, name);
      if (name.endsWith(".tmp")) {
        await rm(file, { force: true });
        return;
      }
      if (!name.endsWith(".json")) return;
      try {
        const parsed: unknown = JSON.parse(await readFile(file, "utf8"));
        const pid = fields(parsed, "active run").get("pid");
        if (typeof pid === "number" && alive(pid)) return;
      } catch {
        // Malformed or unreadable.
      }
      await rm(file, { force: true });
    }),
  );
}

async function publishActive(file: string, body: unknown): Promise<void> {
  await mkdir(activeDir, { recursive: true, mode: 0o700 });
  await chmod(activeDir, 0o700);
  const tmp = `${file}.${randomUUID()}.tmp`;
  await writeFile(tmp, `${JSON.stringify(body)}\n`, { mode: 0o600 });
  await chmod(tmp, 0o600);
  await rename(tmp, file);
}

type Naming = {
  readonly keyRef: string;
  readonly url: string;
  readonly timeoutMs: number;
  readonly request: (message: string, key: string) => unknown;
  readonly parse: (status: number, body: unknown) => Named;
  readonly freeBranch: Runtime["freeBranch"];
};

function member(module: Map<string, unknown>, name: string): unknown {
  const value = module.get(name);
  if (value === undefined)
    throw new TypeError(`naming.js does not export ${name}.`);
  return value;
}

function callable(
  value: unknown,
  name: string,
): (...args: unknown[]) => unknown {
  if (typeof value !== "function")
    throw new TypeError(`naming.js ${name} is not a function.`);
  return (...args) => {
    const result: unknown = Reflect.apply(value, undefined, args);
    return result;
  };
}

function exported(value: unknown, name: string): string {
  if (typeof value !== "string")
    throw new TypeError(`naming.js ${name} is not a string.`);
  return value;
}

function named(value: unknown): Named {
  const n = fields(value, "A name");
  const branch = n.get("branch");
  const title = n.get("title");
  if (typeof branch !== "string" || typeof title !== "string")
    throw new TypeError("naming.js returned no branch or title.");
  return { branch, title };
}

async function loadNaming(): Promise<Naming> {
  const module = fields(await import(namingPath), "naming.js");
  const keyRef = exported(member(module, "KEY_REF"), "KEY_REF");
  const url = exported(member(module, "RESPONSES_URL"), "RESPONSES_URL");
  const timeoutMs = member(module, "TIMEOUT_MS");
  if (typeof timeoutMs !== "number")
    throw new TypeError("naming.js TIMEOUT_MS is not a number.");
  const request = callable(member(module, "namingRequest"), "namingRequest");
  const parse = callable(member(module, "parseNaming"), "parseNaming");
  const free = callable(member(module, "freeBranch"), "freeBranch");
  return {
    keyRef,
    url,
    timeoutMs,
    request,
    parse: (code, body) => named(parse(code, body)),
    freeBranch: async (base, taken) => {
      const branch: unknown = await free(base, taken);
      if (typeof branch !== "string")
        throw new TypeError("naming.js freeBranch returned no branch.");
      return branch;
    },
  };
}

async function capture(
  argv: string[],
  env?: Record<string, string>,
): Promise<ExecResult> {
  const child = Bun.spawn(argv, {
    ...(env === undefined ? {} : { env: { ...Bun.env, ...env } }),
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { code, stdout, stderr };
}

function firstLine(text: string, fallback: string): string {
  const line = text.trim().split("\n")[0] ?? "";
  return line === "" ? fallback : line;
}

function decoded(value: unknown): string {
  return typeof value === "string"
    ? Buffer.from(value, "base64").toString("utf8")
    : "";
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function fetchOptions(value: unknown): RequestInit {
  const options = fields(value, "namingRequest()");
  const method = options.get("method");
  const body = options.get("body");
  const headers = fields(options.get("headers"), "namingRequest() headers");
  if (typeof method !== "string" || typeof body !== "string")
    throw new TypeError("namingRequest() returned no method or body.");
  const flat: Record<string, string> = {};
  for (const [key, header] of headers) {
    if (typeof header !== "string")
      throw new TypeError(`namingRequest() header ${key} is not a string.`);
    flat[key] = header;
  }
  return { method, body, headers: flat };
}

function runtime(naming: Naming): Runtime {
  let key: string | null = null;
  async function readKey(): Promise<string> {
    if (key !== null) return key;
    const read = await capture(["op", "read", naming.keyRef]);
    const value = read.stdout.trim();
    if (value === "" || read.code !== 0)
      throw new Error(`1Password: ${firstLine(read.stderr, "op read failed")}`);
    key = value;
    return value;
  }
  return {
    async name(message) {
      const init = fetchOptions(naming.request(message, await readKey()));
      let reply: Response;
      try {
        reply = await fetch(naming.url, {
          ...init,
          signal: AbortSignal.timeout(naming.timeoutMs),
        });
      } catch (error) {
        const timedOut =
          error instanceof DOMException && error.name === "TimeoutError";
        throw new Error(
          timedOut
            ? `OpenAI didn't answer in ${String(naming.timeoutMs / 1000)} s.`
            : `OpenAI: ${describe(error)}`,
          { cause: error },
        );
      }
      const body: unknown = await reply.json().catch(() => null);
      return naming.parse(reply.status, body);
    },
    freeBranch: naming.freeBranch,
    async git(machine, cwd, args) {
      const r = await capture([
        hcPath,
        "exec",
        "--json",
        ...(machine === null ? [] : ["--on", machine]),
        "--cwd",
        cwd,
        "--timeout",
        "300",
        "--",
        "git",
        ...args,
      ]);
      if (r.code !== 0)
        throw new Error(
          `hc exec failed: ${firstLine(r.stderr === "" ? r.stdout : r.stderr, "no output")}`,
        );
      const out = fields(JSON.parse(r.stdout), "hc exec output");
      const code = out.get("code");
      return {
        code: typeof code === "number" ? code : 1,
        stdout: decoded(out.get("stdout")),
        stderr: decoded(out.get("stderr")),
      };
    },
    async newSpace(args) {
      const r = await capture([
        herdrAppPath,
        "do",
        "space.new",
        JSON.stringify(args),
      ]);
      if (r.code !== 0)
        throw new Error(
          `Herdr didn't open the space: ${firstLine(r.stderr === "" ? r.stdout : r.stderr, "no output")}`,
        );
      const terminal = fields(JSON.parse(r.stdout), "space.new output").get(
        "terminal",
      );
      if (typeof terminal !== "string")
        throw new TypeError("Herdr opened the space but named no terminal.");
      return terminal;
    },
    hc: async (args) => capture([hcPath, ...args]),
    sleep: async (ms) => Bun.sleep(ms),
  };
}

type Event = {
  ts: string;
  host: string;
  provider: string | null;
  machine: string | null;
  ok: boolean;
  step: Step | "request";
  ms: number;
  error: string | null;
  branch: string | null;
  title: string | null;
  path: string | null;
  terminal: string | null;
  messageSent: string | null;
};

function summary(event: Event): string {
  const where = `${event.provider ?? "shell"} on ${event.machine ?? event.host}`;
  return event.ok
    ? `${logTag}: ok; ${where}; branch ${event.branch ?? "?"}; ${String(event.ms)} ms`
    : `${logTag}: FAILED at ${event.step}; ${where}; error: ${event.error ?? "unknown"}`;
}

// A Windows toast, sent as Windows PowerShell (pwsh has no WinRT projection).
// Title and body travel as variables, so no text is parsed as script.
const windowsToast = [
  "[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null",
  "$xml = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)",
  "$text = $xml.GetElementsByTagName('text')",
  "$text.Item(0).AppendChild($xml.CreateTextNode($env:TOAST_TITLE)) > $null",
  "$text.Item(1).AppendChild($xml.CreateTextNode($env:TOAST_BODY)) > $null",
  String.raw`[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe').Show([Windows.UI.Notifications.ToastNotification]::new($xml))`,
].join("; ");

async function report(event: Event): Promise<void> {
  // The dialog is gone, so a failure needs a notification of its own.
  if (windows) {
    if (!event.ok)
      await capture(
        [
          "powershell.exe",
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          windowsToast,
        ],
        {
          TOAST_TITLE: "New worktree failed",
          TOAST_BODY: event.error ?? "unknown error",
        },
      );
    return;
  }
  // Mirror to the unified log (`logger -t` alone isn't searchable there).
  await capture([
    "/usr/bin/logger",
    "-t",
    logTag,
    "-p",
    event.ok ? "user.notice" : "user.err",
    summary(event),
  ]);
  if (!event.ok)
    await capture([
      "/usr/bin/osascript",
      "-e",
      "on run argv",
      "-e",
      "display notification (item 2 of argv) with title (item 1 of argv)",
      "-e",
      "end run",
      "New worktree failed",
      event.error ?? "unknown error",
    ]);
}

async function status(): Promise<number> {
  let contents: string;
  try {
    contents = await readFile(eventsPath, "utf8");
  } catch {
    console.log(`No runs recorded in ${eventsPath}.`);
    return 0;
  }
  let lastOk = true;
  for (const line of contents.split("\n").filter(Boolean).slice(-10)) {
    const event = fields(JSON.parse(line), "An event");
    lastOk = event.get("ok") === true;
    console.log(line);
  }
  return lastOk ? 0 : 1;
}

async function run(json: string): Promise<number> {
  const started = Date.now();
  let step: Step | "request" = "request";
  const activeFile = path.join(activeDir, `${randomUUID()}.json`);
  const event: Event = {
    ts: new Date(started).toISOString(),
    host: hostname(),
    provider: null,
    machine: null,
    ok: false,
    step,
    ms: 0,
    error: null,
    branch: null,
    title: null,
    path: null,
    terminal: null,
    messageSent: null,
  };
  try {
    try {
      await sweepActive();
    } catch {
      // A stale status file must not stop the worktree.
    }
    const request = parseRequest(json);
    event.provider = request.provider;
    event.machine = request.machine;
    const outcome = await createWorktree(
      request,
      runtime(await loadNaming()),
      async (update: Progress) => {
        step = update.step;
        try {
          await publishActive(
            activeFile,
            activeRun(request, update, process.pid),
          );
        } catch {
          // The sidebar indicator is optional; the worktree still proceeds.
        }
      },
    );
    Object.assign(event, outcome, { ok: true });
  } catch (error) {
    event.error = describe(error);
  } finally {
    try {
      await rm(activeFile, { force: true });
    } catch {
      // Missing already: the row is gone.
    }
  }
  event.step = step;
  event.ms = Date.now() - started;
  try {
    await mkdir(path.dirname(eventsPath), { recursive: true, mode: 0o700 });
    await appendFile(eventsPath, `${JSON.stringify(event)}\n`, { mode: 0o600 });
  } catch (error) {
    event.ok = false;
    event.error = [event.error, `events.jsonl not written: ${describe(error)}`]
      .filter((part) => part !== null)
      .join("; ");
  }
  await report(event);
  return event.ok ? 0 : 1;
}

async function main(argv: string[]): Promise<number> {
  const [first] = argv;
  if (first === "--status" && argv.length === 1) return status();
  const fromVariable =
    first === "--request-env" && argv.length === 1
      ? Bun.env[requestVariable]
      : undefined;
  if (fromVariable !== undefined) return run(fromVariable);
  if (
    first === undefined ||
    first === "--help" ||
    first === "--request-env" ||
    argv.length !== 1
  ) {
    console.error(
      `Usage: herdr-new-worktree '<request json>' | --request-env | --status\nStarted by the Herdr new-worktree dialog (--request-env reads ${requestVariable}); results go to ${eventsPath}`,
    );
    return 2;
  }
  return run(first);
}

process.exitCode = await main(process.argv.slice(2));
