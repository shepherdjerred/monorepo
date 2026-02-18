import _ from "lodash";
import type { CommandInput} from "./commandInput.ts";
import { parseCommandInput } from "./commandInput.ts";

export type Chord = CommandInput[];

export function parseChord(input: string): Chord | undefined {
  const commands = input.split(" ").map(parseCommandInput);
  return commands.includes(undefined) ? undefined : commands as Chord;
}
