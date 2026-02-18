import type { CommandInput} from "./command-input.ts";
import { parseCommandInput } from "./command-input.ts";

export type Chord = CommandInput[];

export function parseChord(input: string): Chord | undefined {
  const commands: CommandInput[] = [];
  for (const cmd of input.split(" ")) {
    const parsed = parseCommandInput(cmd);
    if (parsed === undefined) {
      return undefined;
    }
    commands.push(parsed);
  }
  return commands.length > 0 ? commands : undefined;
}
