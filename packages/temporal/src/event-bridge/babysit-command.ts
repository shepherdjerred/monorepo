/**
 * Pure parser for babysitter comment commands. A control command requires the
 * bot handle as the FIRST non-whitespace token (anchored, case-insensitive) so
 * the bot never fires when someone merely quotes or discusses it mid-sentence.
 *
 *   <handle> help me get this green   → start (instruction = "me get this green")
 *   <handle> babysit                  → start
 *   <handle> stop [force]             → stop
 *   <handle> status                   → status
 *   <handle>                          → start
 *   …anything not led by the handle…  → none
 */
export type BabysitCommand =
  | { kind: "start"; instruction?: string }
  | { kind: "stop"; force: boolean }
  | { kind: "status" }
  | { kind: "none" };

const START_VERBS = new Set(["help", "babysit", "start", "go", "green"]);
const STOP_VERBS = new Set(["stop", "cancel", "halt", "abort", "pause"]);
const STATUS_VERBS = new Set(["status", "?"]);

function startCommand(instruction: string): BabysitCommand {
  const trimmed = instruction.trim();
  return trimmed.length > 0
    ? { kind: "start", instruction: trimmed }
    : { kind: "start" };
}

export function parseBabysitCommand(
  body: string,
  handle: string,
): BabysitCommand {
  const tokens = body
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 0);
  const first = tokens[0]?.toLowerCase();
  if (first === undefined || first !== handle.toLowerCase()) {
    return { kind: "none" };
  }
  const verb = tokens[1]?.toLowerCase();
  if (verb === undefined) {
    return { kind: "start" };
  }
  if (STOP_VERBS.has(verb)) {
    const force = tokens.slice(2).some((t) => t.toLowerCase() === "force");
    return { kind: "stop", force };
  }
  if (STATUS_VERBS.has(verb)) {
    return { kind: "status" };
  }
  if (START_VERBS.has(verb)) {
    return startCommand(tokens.slice(2).join(" "));
  }
  // Handle present but no recognized verb → treat the whole remainder as the goal.
  return startCommand(tokens.slice(1).join(" "));
}
