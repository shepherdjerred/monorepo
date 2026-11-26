import type { Runtime } from "./codex_theme_restart_terminal.ts";
import { uuid } from "./codex_theme_restart_launch.ts";

/** The managed status line puts the full current session ID first. */
export function activeThreadIn(screen: string): string | undefined {
  const lines = screen.trimEnd().split("\n").slice(-5);
  const composer = lines.findLastIndex((line) => /^\s*›/.test(line));
  if (composer === -1) return undefined;
  const ids = lines.slice(composer + 1).flatMap((line) => {
    const value = line.trim().split(" · ")[0];
    return value !== undefined && uuid.test(value) ? [value] : [];
  });
  return ids.length === 1 ? ids[0] : undefined;
}

async function readTerminal(
  runtime: Runtime,
  terminal: string,
): Promise<string> {
  const output = await runtime.hc(["read", terminal]);
  if (output.length === 0) throw new Error("Missing terminal text from hc");
  return output;
}

async function waitForScreen(
  runtime: Runtime,
  terminal: string,
  ready: (screen: string) => boolean,
  failure = "Expected Codex screen did not appear",
): Promise<string> {
  const deadline = runtime.now() + 5000;
  while (runtime.now() < deadline) {
    const screen = await readTerminal(runtime, terminal);
    if (ready(screen)) return screen;
    await runtime.sleep(100);
  }
  throw new Error(failure);
}

/** A freshly started client is ready once it shows its composer or the paused-goal dialog. */
export async function waitForStartup(
  runtime: Runtime,
  terminal: string,
): Promise<void> {
  await waitForScreen(
    runtime,
    terminal,
    (screen) => screen.includes("Resume paused goal?") || emptyComposer(screen),
    "Restarted Codex did not show its composer within 5 seconds",
  );
}

/** Only the live composer counts; quoted prompts elsewhere in the transcript do not. */
export function emptyComposer(screen: string): boolean {
  const lines = screen.split("\n");
  const composer = lines.findLastIndex((line) => /^\s*›/.test(line));
  return (
    composer !== -1 &&
    !screen.includes("enter select · esc back") &&
    !screen.includes("Resume paused goal?") &&
    lines[composer]?.trim() === "› Ask Codex to do anything" &&
    !lines
      .slice(composer + 1)
      .some((line) => /^\s*\S/.test(line) && !/^\s{2,}/.test(line)) &&
    !/Vim: (?:Normal|Replace)/.test(lines.slice(composer).join("\n"))
  );
}

async function selectSecondChoice(
  runtime: Runtime,
  terminal: string,
  { screen, selected }: { screen: string; selected: RegExp },
  verify: () => Promise<void>,
): Promise<void> {
  if (!selected.test(screen)) {
    await verify();
    await runtime.hc(["keys", terminal, "down"]);
    await waitForScreen(runtime, terminal, (value) => selected.test(value));
  }
  await verify();
  if (!selected.test(await readTerminal(runtime, terminal)))
    throw new Error("Codex dialog changed before confirmation");
  await runtime.hc(["keys", terminal, "enter"]);
}

/** A resumed paused goal must stay paused; never accept the default resume action. */
export async function preservePausedGoal(
  runtime: Runtime,
  terminal: string,
  verify: () => Promise<void>,
): Promise<void> {
  const screen = await readTerminal(runtime, terminal);
  if (!screen.includes("Resume paused goal?")) return;
  const selected = /›\s*2\. Leave paused/;
  if (
    !screen.includes("Keep it paused; use /goal resume later") ||
    !screen.includes("enter select · esc back") ||
    (!/›\s*1\. Resume goal/.test(screen) && !selected.test(screen))
  )
    throw new Error("Unrecognized paused-goal dialog; left untouched");
  await selectSecondChoice(runtime, terminal, { screen, selected }, verify);
  await waitForScreen(
    runtime,
    terminal,
    (value) => !value.includes("Resume paused goal?") && emptyComposer(value),
  );
}

export function requireEmptyComposer(screen: string): void {
  if (!emptyComposer(screen)) {
    throw new Error(
      "Composer is not confirmed empty and ready; draft or dialog left untouched",
    );
  }
}
