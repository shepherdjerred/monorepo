import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { uuid } from "./codex_theme_restart_launch.ts";
import {
  object,
  parseSnapshot,
  type Snapshot,
} from "./codex_theme_restart_terminal.ts";

const directory = path.join(
  homedir(),
  ".local/state/codex-theme-restart/identities",
);
const terminalId = /^t[a-z0-9]+$/;

function identityFile(terminal: string): string {
  if (!terminalId.test(terminal))
    throw new Error("Invalid local Herdr terminal address");
  return path.join(directory, `${terminal}.json`);
}

async function processStart(pid: number): Promise<string | undefined> {
  const child = Bun.spawn(["/bin/ps", "-p", String(pid), "-o", "lstart="], {
    stdout: "pipe",
    stderr: "ignore",
    timeout: 1500,
  });
  const [text, code] = await Promise.all([child.stdout.text(), child.exited]);
  return code === 0 && text.trim() !== "" ? text.trim() : undefined;
}

async function savedTranscript(file: string, thread: string): Promise<boolean> {
  if (!path.isAbsolute(file)) return false;
  try {
    // A rollout can be gigabytes. Read only its session header.
    const header = await Bun.file(file)
      .slice(0, 2 * 1024 * 1024)
      .text();
    const first = header.split("\n", 1)[0];
    if (first === undefined || first === "") return false;
    const record = object(JSON.parse(first));
    return (
      record.get("type") === "session_meta" &&
      object(record.get("payload")).get("id") === thread
    );
  } catch {
    return false;
  }
}

async function readIdentity(
  terminal: string,
): Promise<Map<string, unknown> | undefined> {
  try {
    return object(JSON.parse(await readFile(identityFile(terminal), "utf8")));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return undefined;
    throw error;
  }
}

function sameProcess(
  record: Map<string, unknown>,
  snapshot: Snapshot,
): boolean {
  return (
    record.get("pid") === snapshot.foreground.pid &&
    record.get("created") === snapshot.created
  );
}

export async function verifyIdentity(
  snapshot: Snapshot,
  observed: string | undefined,
): Promise<string | undefined> {
  if (observed === undefined) return undefined;
  const record = await readIdentity(snapshot.terminal);
  if (record === undefined || !sameProcess(record, snapshot)) return undefined;
  const start = await processStart(snapshot.foreground.pid);
  if (start === undefined || start !== record.get("start")) return undefined;
  const thread = record.get("thread");
  const transcript = record.get("transcript");
  if (
    typeof thread !== "string" ||
    typeof transcript !== "string" ||
    thread !== observed
  )
    return undefined;
  return (await savedTranscript(transcript, thread)) ? thread : undefined;
}

/** Codex defers SessionStart on a resumed client until its first turn. */
export async function adoptResumedIdentity(
  replacement: Snapshot,
  original: Snapshot,
  thread: string,
): Promise<boolean> {
  const record = await readIdentity(original.terminal);
  if (
    record === undefined ||
    !sameProcess(record, original) ||
    record.get("thread") !== thread
  )
    return false;
  const transcript = record.get("transcript");
  if (typeof transcript !== "string") return false;
  const start = await processStart(replacement.foreground.pid);
  if (start === undefined || !(await savedTranscript(transcript, thread)))
    return false;
  await writeIdentity(replacement, start, thread, transcript);
  return true;
}

async function hookEvent(): Promise<{
  name: string;
  thread: string;
  transcript: string | null;
}> {
  const event = object(JSON.parse(await Bun.stdin.text()));
  const name = event.get("hook_event_name");
  const thread = event.get("session_id");
  const transcript = event.get("transcript_path");
  if (
    typeof thread !== "string" ||
    (name !== "SessionStart" && name !== "UserPromptSubmit") ||
    (transcript !== null && typeof transcript !== "string") ||
    !uuid.test(thread)
  )
    throw new Error("Unrecognized Codex session hook payload");
  return { name, thread, transcript };
}

async function recordHook(): Promise<void> {
  const terminal = Bun.env["HC_TERMINAL_ID"];
  const pid = Number(Bun.env["HERDR_CODEX_PID"]);
  if (
    terminal === undefined ||
    pid <= 0 ||
    !terminalId.test(terminal) ||
    !Number.isSafeInteger(pid)
  )
    return;
  const { name, thread, transcript } = await hookEvent();
  const child = Bun.spawn(
    [path.join(homedir(), ".local/bin/hc"), "get", terminal, "--json"],
    {
      stdout: "pipe",
      stderr: "ignore",
      timeout: 1500,
    },
  );
  const [output, code] = await Promise.all([child.stdout.text(), child.exited]);
  if (code !== 0) throw new Error("Could not inspect the Herdr terminal");
  const snapshot = parseSnapshot(JSON.parse(output));
  if (snapshot.foreground.pid !== pid || snapshot.terminal !== terminal) return;
  const start = await processStart(pid);
  if (start === undefined) return;
  if (name === "UserPromptSubmit") {
    // An older thread can still complete asynchronously after switching away.
    // Only SessionStart may change the identity of the foreground session.
    const current = await readIdentity(terminal);
    if (
      current === undefined ||
      typeof transcript !== "string" ||
      !sameProcess(current, snapshot) ||
      current.get("start") !== start ||
      current.get("thread") !== thread
    )
      return;
  }
  await writeIdentity(snapshot, start, thread, transcript);
}

async function writeIdentity(
  snapshot: Snapshot,
  start: string,
  thread: string,
  transcript: string | null,
): Promise<void> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const file = identityFile(snapshot.terminal);
  const temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(
    temporary,
    JSON.stringify({
      pid: snapshot.foreground.pid,
      created: snapshot.created,
      start,
      thread,
      transcript,
    }),
    {
      mode: 0o600,
    },
  );
  await rename(temporary, file);
}

if (import.meta.main) {
  try {
    await recordHook();
  } catch {
    console.error("Herdr Codex identity hook could not record this session.");
    process.exitCode = 1;
  }
}
