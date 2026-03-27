import { createInterface } from "node:readline/promises";

export type Command =
  | { type: "text"; content: string }
  | { type: "run" }
  | { type: "hint" }
  | { type: "score" }
  | { type: "time" }
  | { type: "quit" };

export function parseCommand(input: string): Command {
  const trimmed = input.trim();

  switch (trimmed.toLowerCase()) {
    case "/run":
      return { type: "run" };
    case "/hint":
      return { type: "hint" };
    case "/score":
      return { type: "score" };
    case "/time":
      return { type: "time" };
    case "/quit":
    case "/q":
    case "/exit":
      return { type: "quit" };
    default:
      return { type: "text", content: trimmed };
  }
}

export async function promptUser(rl: ReturnType<typeof createInterface>): Promise<string> {
  const answer = await rl.question("\n> ");
  return answer;
}

export function createReadline(): ReturnType<typeof createInterface> {
  return createInterface({
    input: process.stdin,
    output: process.stdout,
  });
}

export function printHelp(): void {
  console.log(`
Commands:
  /run   - Run your solution against hidden tests
  /hint  - Request a hint (affects scoring)
  /score - Show current assessment
  /time  - Show remaining time
  /quit  - End the session
  (anything else is sent to the interviewer)
`);
}
