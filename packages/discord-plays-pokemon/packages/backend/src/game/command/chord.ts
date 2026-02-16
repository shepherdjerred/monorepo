import _ from "lodash";
import { CommandInput, parseCommandInput } from "./commandInput.js";

export type Chord = CommandInput[];

export function parseChord(input: string): Chord | undefined {
  const commands = input.split(" ").map(parseCommandInput);
  if (commands.filter((command) => command === undefined).length) {
    return undefined;
  } else {
    return commands as Chord;
  }
}
