import _ from "lodash";
import type { CommandInput} from "./command-input.ts";
import { parseCommandInput } from "./command-input.ts";

export type Chord = CommandInput[];

export function parseChord(input: string): Chord | undefined {
  const commands = input.split(" ").map((cmd) => parseCommandInput(cmd));
  return commands.includes(undefined) ? undefined : commands as Chord;
}
