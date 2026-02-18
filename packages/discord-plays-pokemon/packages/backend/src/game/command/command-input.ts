import type { Command} from "./command.ts";
import { isCommand } from "./command.ts";

export type Quantity = number;

export const burst = ["-"];
type Burst = (typeof burst)[number];
export function isBurst(input: string): input is Burst {
  return burst.includes(input);
}

export const hold = ["_"];
type Hold = (typeof hold)[number];
export function isHold(input: string): input is Hold {
  return hold.includes(input);
}

export const holdB = ["^"];
type HoldB = (typeof holdB)[number];
export function isHoldB(input: string): input is HoldB {
  return holdB.includes(input);
}

const modifier = [...burst, ...hold, ...holdB];
export type Modifier = (typeof modifier)[number];
export function isModifier(input: string): input is Modifier {
  return modifier.includes(input.toLowerCase());
}

export type CommandInput = {
  command: Command;
  quantity: Quantity;
  modifier?: Modifier;
}

export function parseCommandInput(input: string): CommandInput | undefined {
  let split = input
    .split(/(\d*)([-_]*)([a-z]+)/i)
    .filter((group) => group !== "");

  let quantity: Quantity = 1;
  if (split.length > 0 && !Number.isNaN(Number.parseInt(split[0]))) {
    quantity = Number.parseInt(split[0]);
    [, ...split] = split;
  }

  let modifier: Modifier | undefined;
  if (split.length > 0 && isModifier(split[0])) {
    modifier = split[0];
    [, ...split] = split;
  }

  let command: string | undefined;
  if (split.length > 0 && isCommand(split[0])) {
    command = split[0].toLowerCase();
    [, ...split] = split;
  }

  if (split.length === 0 && command !== undefined) {
    return {
      command,
      quantity,
      modifier,
    };
  }

  return undefined;
}
