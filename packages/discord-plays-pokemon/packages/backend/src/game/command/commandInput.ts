import { Command, isCommand } from "./command.js";

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

export const hold_b = ["^"];
type HoldB = (typeof hold_b)[number];
export function isHoldB(input: string): input is HoldB {
  return hold_b.includes(input);
}

const modifier = [...burst, ...hold, ...hold_b];
export type Modifier = (typeof modifier)[number];
export function isModifier(input: string): input is Modifier {
  return modifier.includes(input.toLowerCase());
}

export interface CommandInput {
  command: Command;
  quantity: Quantity;
  modifier?: Modifier;
}

export function parseCommandInput(input: string): CommandInput | undefined {
  let split = input.split(/([0-9]*)([-_]*)([a-zA-Z]+)/).filter((group) => group !== "");

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

  if (split.length === 0 && command) {
    return {
      command,
      quantity,
      modifier,
    };
  }

  return undefined;
}
