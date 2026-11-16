#!/usr/bin/env bun
// Started detached by the Herdr session-takeover dialog, which closes at once:
// `herdr-takeover '<request json>'`. See herdr_takeover_core.ts.
// `herdr-takeover --status` prints the last runs.
import { randomUUID } from "node:crypto";
import { appendFile, chmod, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { homedir, hostname } from "node:os";
import path from "node:path";
import {
  fields,
  isCrossMachine,
  normPath,
  parseRequest,
  takeOverSession,
  type ExecResult,
  type MachineEnv,
  type Progress,
  type Runtime,
  type SpaceInfo,
  type Step,
} from "./herdr_takeover_core.ts";

const home = homedir();
const windows = process.platform === "win32";
const hcPath = windows ? "hc" : path.join(home, ".local/bin/hc");
const herdrAppPath = windows ? "herdr-app" : path.join(home, ".local/bin/herdr-app");
const brimPath = windows ? "brim" : path.join(home, ".local/bin/brim");
// On Windows the dialog passes the request in this variable: Start-Process
// does not quote arguments, so JSON cannot go on the command line.
const requestVariable = "HERDR_TAKEOVER_REQUEST";
const stateRoot = path.join(home, ".local/state/herdr-takeover");
const eventsPath = path.join(stateRoot, "events.jsonl");
const handoffsDir = path.join(stateRoot, "handoffs");
const logTag = "herdr-takeover";

const psArgs = (script: string) => ["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", script];
const firstLine = (text: string, fallback: string) => (text.trim().split("\n")[0] ?? "") || fallback;
const resultLine = (r: ExecResult, fallback: string) => firstLine(r.stderr === "" ? r.stdout : r.stderr, fallback);
const decoded = (v: unknown) => (typeof v === "string" ? Buffer.from(v, "base64").toString("utf8") : "");
const describe = (e: unknown) => (e instanceof Error ? e.message : String(e));

async function capture(
  argv: string[],
  options?: { env?: Record<string, string>; cwd?: string; stdin?: string },
): Promise<ExecResult> {
  const child = Bun.spawn(argv, {
    ...(options?.env === undefined ? {} : { env: { ...Bun.env, ...options.env } }),
    ...(options?.cwd === undefined ? {} : { cwd: options.cwd }),
    stdin: options?.stdin === undefined ? "ignore" : new TextEncoder().encode(options.stdin),
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

async function hcExec(
  machine: string,
  cwd: string | null,
  command: string[],
  options?: { stdin?: string; env?: Record<string, string> },
): Promise<ExecResult> {
  const envFlags = options?.env ? Object.entries(options.env).flatMap(([k, v]) => ["--env", `${k}=${v}`]) : [];
  const argv = [
    hcPath,
    "exec",
    "--json",
    "--on",
    machine,
    ...(cwd === null ? [] : ["--cwd", cwd]),
    ...envFlags,
    "--timeout",
    "120",
    ...(options?.stdin === undefined ? [] : ["-i"]),
    "--",
    ...command,
  ];
  const r = await capture(argv, options?.stdin === undefined ? undefined : { stdin: options.stdin });
  if (r.code !== 0) throw new Error(`hc exec failed: ${resultLine(r, "no output")}`);
  const out = fields(JSON.parse(r.stdout), "hc exec output");
  const code = out.get("code");
  return { code: typeof code === "number" ? code : 1, stdout: decoded(out.get("stdout")), stderr: decoded(out.get("stderr")) };
}

async function tryHcExec(
  machine: string,
  command: string[],
  options?: { stdin?: string; env?: Record<string, string> },
): Promise<ExecResult | null> {
  try {
    return await hcExec(machine, null, command, options);
  } catch {
    return null;
  }
}

async function herdrDo(command: string, args: Record<string, unknown>): Promise<Map<string, unknown>> {
  const r = await capture([herdrAppPath, "do", command, JSON.stringify(args)]);
  if (r.code !== 0) throw new Error(`Herdr ${command} failed: ${resultLine(r, "no output")}`);
  const trimmed = r.stdout.trim();
  return trimmed === "" ? new Map<string, unknown>() : fields(JSON.parse(trimmed), `${command} output`);
}

const herdrVoid = async (command: string, args: Record<string, unknown>): Promise<void> => {
  await herdrDo(command, args);
};

async function resolveMachineEnv(machine: string | null): Promise<MachineEnv> {
  if (machine === null) return { home: home.replaceAll("\\", "/"), windows };
  const posix = await tryHcExec(machine, ["sh", "-c", 'printf %s "$HOME"']);
  if (posix?.code === 0 && posix.stdout.trim() !== "")
    return { home: posix.stdout.trim().replaceAll("\\", "/"), windows: false };
  const win = await hcExec(machine, null, psArgs("[Console]::Write($HOME)"));
  if (win.code === 0 && win.stdout.trim() !== "")
    return { home: win.stdout.trim().replaceAll("\\", "/"), windows: true };
  throw new Error(`Could not resolve home directory on ${machine}: ${resultLine(win, "hc exec failed")}`);
}

async function checkDirExists(machine: string | null, dir: string, isWin: boolean): Promise<boolean> {
  if (machine === null) {
    try {
      const info = await stat(dir);
      return info.isDirectory();
    } catch {
      return false;
    }
  }
  const res = isWin
    ? await tryHcExec(
        machine,
        psArgs("if (Test-Path -LiteralPath $env:HERDR_CHECK_DIR -PathType Container) { exit 0 } else { exit 1 }"),
        { env: { HERDR_CHECK_DIR: dir } },
      )
    : await tryHcExec(machine, ["sh", "-c", 'test -d "$1"', "_", dir]);
  return res?.code === 0;
}

async function readRemoteOrLocalHandoff(machine: string | null, filePath: string, isWin: boolean): Promise<string> {
  if (machine === null) return Bun.file(filePath).text();
  const cmd = "[Console]::OutputEncoding = [Text.Encoding]::UTF8; [Console]::Write([IO.File]::ReadAllText($env:HERDR_READ_FILE))";
  const res = isWin
    ? await hcExec(machine, null, psArgs(cmd), { env: { HERDR_READ_FILE: filePath } })
    : await hcExec(machine, null, ["sh", "-c", 'cat "$1"', "_", filePath]);
  if (res.code !== 0)
    throw new Error(`Could not read handoff file ${filePath} on ${machine}: ${resultLine(res, "read failed")}`);
  return res.stdout;
}

async function writeRemoteOrLocalTargetHandoff(
  machine: string | null,
  env: MachineEnv,
  fileName: string,
  markdown: string,
): Promise<string> {
  const dir = `${normPath(env.home)}/.toolkit/takeovers`;
  const targetPath = `${dir}/${fileName}`;
  if (machine === null) {
    await mkdir(dir, { recursive: true, mode: 0o700 });
    if (!env.windows) await chmod(dir, 0o700);
    await writeFile(targetPath, markdown, { mode: 0o600 });
    if (!env.windows) await chmod(targetPath, 0o600);
    return targetPath;
  }
  const winCmd =
    "$t = [Console]::In.ReadToEnd(); New-Item -ItemType Directory -Force -Path $env:HERDR_WRITE_DIR | Out-Null; [IO.File]::WriteAllText($env:HERDR_WRITE_FILE, $t, (New-Object System.Text.UTF8Encoding($false)))";
  const shCmd = 'mkdir -p -m 700 "$1" && chmod 700 "$1" && umask 077 && cat > "$2"';
  const res = env.windows
    ? await hcExec(machine, null, psArgs(winCmd), { stdin: markdown, env: { HERDR_WRITE_DIR: dir, HERDR_WRITE_FILE: targetPath } })
    : await hcExec(machine, null, ["sh", "-c", shCmd, "_", dir, targetPath], { stdin: markdown });
  if (res.code !== 0)
    throw new Error(`Could not write handoff file ${targetPath} on ${machine}: ${resultLine(res, "write failed")}`);
  return targetPath;
}

async function fetchSpaces(): Promise<readonly SpaceInfo[]> {
  const r = await capture([herdrAppPath, "ls"]);
  if (r.code !== 0) throw new Error(`Herdr ls failed: ${resultLine(r, "no output")}`);
  const rawSpaces = fields(JSON.parse(r.stdout), "herdr-app ls output").get("spaces");
  if (!Array.isArray(rawSpaces)) return [];
  const out: SpaceInfo[] = [];
  for (const item of rawSpaces) {
    const s = fields(item, "space");
    const [id, name, folder, machine] = [s.get("id"), s.get("name"), s.get("folder"), s.get("machine")];
    if (typeof id !== "string" || id === "") continue;
    out.push({
      id,
      name: typeof name === "string" ? name : "",
      folder: typeof folder === "string" && folder !== "" ? folder : null,
      machine: typeof machine === "string" && machine !== "" ? machine : null,
    });
  }
  return out;
}

function runtime(): Runtime {
  return {
    brim: async (m, cwd, args) => (m === null ? capture([brimPath, ...args], { cwd }) : hcExec(m, cwd, ["brim", ...args])),
    git: async (m, cwd, args) => (m === null ? capture(["git", ...args], { cwd }) : hcExec(m, cwd, ["git", ...args])),
    machineEnv: resolveMachineEnv,
    dirExists: checkDirExists,
    readHandoff: readRemoteOrLocalHandoff,
    writeTargetHandoff: writeRemoteOrLocalTargetHandoff,
    async writeFallbackHandoff(machine, terminal, markdown) {
      const fileName = `${new Date().toISOString().replaceAll(/[:.]/g, "-")}-${terminal.replaceAll(/[^\w.-]+/g, "-")}-${randomUUID().slice(0, 8)}.md`;
      if (machine === null) {
        await mkdir(handoffsDir, { recursive: true, mode: 0o700 });
        const target = path.join(handoffsDir, fileName);
        await writeFile(target, markdown, { mode: 0o600 });
        if (!windows) await chmod(target, 0o600);
        return target;
      }
      const ps = `$dir = Join-Path $HOME '.local/state/herdr-takeover/handoffs'; New-Item -ItemType Directory -Force -Path $dir > $null; $out = Join-Path $dir '${fileName}'; [System.IO.File]::WriteAllText($out, [Console]::In.ReadToEnd()); [Console]::Write($out)`;
      const written = await tryHcExec(machine, psArgs(ps), { stdin: markdown });
      return written?.code === 0 && written.stdout.trim() !== "" ? written.stdout.trim() : null;
    },
    listSpaces: fetchSpaces,
    async newSpace(args) {
      const out = await herdrDo("space.new", args);
      const [terminal, space, tab] = [out.get("terminal"), out.get("space"), out.get("tab")];
      if (typeof terminal !== "string" || terminal === "") throw new TypeError("Herdr opened the space but named no terminal.");
      return {
        space: typeof space === "string" && space !== "" ? space : null,
        tab: typeof tab === "string" && tab !== "" ? tab : null,
        terminal,
      };
    },
    selectSpace: (args) => herdrVoid("space.select", args),
    closeSpace: (args) => herdrVoid("space.close", args),
    async newTab(args) {
      const out = await herdrDo("tab.new", args);
      const [terminal, tab] = [out.get("terminal"), out.get("tab")];
      if (typeof terminal !== "string" || terminal === "") throw new TypeError("Herdr opened the tab but named no terminal.");
      return { tab: typeof tab === "string" && tab !== "" ? tab : null, terminal };
    },
    moveTab: (args) => herdrVoid("tab.move", args),
    closeTab: (args) => herdrVoid("tab.close", args),
    async splitPane(args) {
      const out = await herdrDo("pane.split", args);
      const terminal = out.get("terminal");
      if (typeof terminal !== "string" || terminal === "") throw new TypeError("Herdr split the pane but named no terminal.");
      return terminal;
    },
    closePane: (args) => herdrVoid("pane.close", args),
    hc: async (args) => capture([hcPath, ...args]),
    sleep: async (ms) => Bun.sleep(ms),
  };
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

type Event = {
  ts: string; host: string; sourceTerminal: string | null; provider: string | null;
  machine: string | null; targetMachine: string | null; migrated: boolean | null;
  ok: boolean; step: Step | "request"; ms: number; error: string | null;
  title: string | null; handoffPath: string | null; terminal: string | null;
  space: string | null; tab: string | null; splitTab: boolean | null; messageSent: string | null;
};

const makeEvent = (started: number): Event => ({
  ts: new Date(started).toISOString(),
  host: hostname(),
  sourceTerminal: null,
  provider: null,
  machine: null,
  targetMachine: null,
  migrated: null,
  ok: false,
  step: "request",
  ms: 0,
  error: null,
  title: null,
  handoffPath: null,
  terminal: null,
  space: null,
  tab: null,
  splitTab: null,
  messageSent: null,
});

function summary(e: Event): string {
  const [src, dst] = [e.machine ?? e.host, e.targetMachine ?? e.host];
  const where =
    e.migrated === true
      ? `${e.sourceTerminal ?? "?"} on ${src} -> ${e.provider ?? "?"} on ${dst}`
      : `${e.sourceTerminal ?? "?"} -> ${e.provider ?? "?"} on ${src}`;
  return e.ok
    ? `${logTag}: ok; ${where}; terminal ${e.terminal ?? "?"}; ${String(e.ms)} ms`
    : `${logTag}: FAILED at ${e.step}; ${where}; error: ${e.error ?? "unknown"}`;
}

async function report(event: Event): Promise<void> {
  const errText = event.error ?? "unknown error";
  if (windows) {
    if (!event.ok)
      await capture(psArgs(windowsToast), { env: { TOAST_TITLE: "Session takeover failed", TOAST_BODY: errText } });
    return;
  }
  await capture(["/usr/bin/logger", "-t", logTag, "-p", event.ok ? "user.notice" : "user.err", summary(event)]);
  if (!event.ok) {
    const script = "on run argv\ndisplay notification (item 2 of argv) with title (item 1 of argv)\nend run";
    await capture(["/usr/bin/osascript", "-e", script, "Session takeover failed", errText]);
  }
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
    lastOk = fields(JSON.parse(line), "An event").get("ok") === true;
    console.log(line);
  }
  return lastOk ? 0 : 1;
}

async function run(json: string): Promise<number> {
  const started = Date.now();
  const event = makeEvent(started);
  try {
    const req = parseRequest(json);
    Object.assign(event, {
      sourceTerminal: req.terminal,
      provider: req.provider,
      machine: req.machine,
      targetMachine: req.targetMachine,
      migrated: isCrossMachine(req),
      splitTab: req.splitTab,
    });
    const out = await takeOverSession(req, runtime(), (u: Progress) => {
      event.step = u.step;
      if (u.title !== null) event.title = u.title;
      if (u.handoffPath !== null) event.handoffPath = u.handoffPath;
    });
    Object.assign(event, {
      title: out.title,
      handoffPath: out.handoffPath,
      terminal: out.terminal,
      space: out.space,
      tab: out.tab,
      migrated: out.migrated,
      messageSent: out.messageSent,
      ok: true,
    });
  } catch (error) {
    event.error = describe(error);
  }
  event.ms = Date.now() - started;
  try {
    await mkdir(path.dirname(eventsPath), { recursive: true, mode: 0o700 });
    await appendFile(eventsPath, `${JSON.stringify(event)}\n`, { mode: 0o600 });
  } catch (error) {
    event.ok = false;
    event.error = [event.error, `events.jsonl not written: ${describe(error)}`].filter(Boolean).join("; ");
  }
  await report(event);
  return event.ok ? 0 : 1;
}

async function main(argv: string[]): Promise<number> {
  const [first] = argv;
  if (first === "--status" && argv.length === 1) return status();
  const fromVariable = first === "--request-env" && argv.length === 1 ? Bun.env[requestVariable] : undefined;
  if (fromVariable !== undefined) return run(fromVariable);
  if (first === undefined || first === "--help" || first === "--request-env" || argv.length !== 1) {
    console.error(
      `Usage: herdr-takeover '<request json>' | --request-env | --status\nStarted by the Herdr takeover dialog (--request-env reads ${requestVariable}); results go to ${eventsPath}`,
    );
    return 2;
  }
  return run(first);
}

process.exitCode = await main(process.argv.slice(2));
