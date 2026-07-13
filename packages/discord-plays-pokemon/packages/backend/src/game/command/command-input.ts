import { command } from "./command.ts";
import type { Command } from "./command.ts";

/** Type-safe check if a readonly tuple includes a string value */
function includesValue(arr: readonly string[], value: string): boolean {
  return arr.includes(value);
}

export type Quantity = number;

export const burst = ["-"] as const;
type Burst = (typeof burst)[number];
export function isBurst(input: string): boolean {
  return includesValue(burst, input);
}

export const hold = ["_"] as const;
type Hold = (typeof hold)[number];
export function isHold(input: string): boolean {
  return includesValue(hold, input);
}

export const holdB = ["^"] as const;
type HoldB = (typeof holdB)[number];
export function isHoldB(input: string): boolean {
  return includesValue(holdB, input);
}

const modifierValues = [...burst, ...hold, ...holdB] as const;
export type Modifier = Burst | Hold | HoldB;
function isModifier(input: string): boolean {
  return includesValue(modifierValues, input.toLowerCase());
}

function findModifier(input: string): Modifier | undefined {
  return modifierValues.find((m) => m === input.toLowerCase());
}

function findCommand(input: string): Command | undefined {
  return command.find((c) => c === input.toLowerCase());
}

export type CommandInput = {
  command: Command;
  quantity: Quantity;
  modifier?: Modifier;
};

export function parseCommandInput(input: string): CommandInput | undefined {
  let split = input
    .split(/(\d*)([-_]*)([a-z]+)/i)
    .filter((group) => group !== "");

  let quantity: Quantity = 1;
  const quantityHead = split[0];
  if (
    quantityHead !== undefined &&
    !Number.isNaN(Number.parseInt(quantityHead))
  ) {
    quantity = Number.parseInt(quantityHead);
    [, ...split] = split;
  }

  let parsedModifier: Modifier | undefined;
  const modifierHead = split[0];
  if (modifierHead !== undefined && isModifier(modifierHead)) {
    parsedModifier = findModifier(modifierHead);
    [, ...split] = split;
  }

  let parsedCommand: Command | undefined;
  const commandHead = split[0];
  if (commandHead !== undefined) {
    parsedCommand = findCommand(commandHead);
    if (parsedCommand !== undefined) {
      [, ...split] = split;
    }
  }

  if (split.length === 0 && parsedCommand !== undefined) {
    return {
      command: parsedCommand,
      quantity,
      ...(parsedModifier === undefined ? {} : { modifier: parsedModifier }),
    };
  }

  return undefined;
}
