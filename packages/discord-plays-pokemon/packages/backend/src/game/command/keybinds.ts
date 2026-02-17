import {
  Command,
  isLeft,
  isRight,
  isUp,
  isDown,
  isA,
  isB,
  isSelect,
  isStart,
} from "./command.js";
import { parseChord } from "./chord.js";
import { CommandInput } from "./commandInput.js";
import { Key } from "selenium-webdriver";

export type KeyInput = string;

export function toGameboyAdvanceKeyInput(command: Command): KeyInput {
  if (isLeft(command)) return Key.ARROW_LEFT;
  if (isRight(command)) return Key.ARROW_RIGHT;
  if (isUp(command)) return Key.ARROW_UP;
  if (isDown(command)) return Key.ARROW_DOWN;
  if (isA(command)) return "Z";
  if (isB(command)) return "X";
  if (isSelect(command)) return "V";
  if (isStart(command)) return "B";
  throw Error("illegal command");
}

export function commandToGameboyAdvanceKeyInput(
  command: CommandInput,
): KeyInput[] {
  const keys: KeyInput[] = [];
  for (let i = 0; i < command.quantity; i++) {
    keys.push(toGameboyAdvanceKeyInput(command.command));
  }
  return keys;
}

export function parseGameboyAdvanceKeyInput(
  input: string,
): KeyInput[] | undefined {
  return parseChord(input)?.flatMap(commandToGameboyAdvanceKeyInput);
}
