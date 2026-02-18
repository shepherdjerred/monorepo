import { command } from "./command.ts";
import type { Command } from "./command.ts";

export type Quantity = number;

export const burst = ["-"] as const;
type Burst = (typeof burst)[number];
export function isBurst(input: string): boolean {
  return (burst as readonly string[]).includes(input);
}

export const hold = ["_"] as const;
type Hold = (typeof hold)[number];
export function isHold(input: string): boolean {
  return (hold as readonly string[]).includes(input);
}

export const holdB = ["^"] as const;
type HoldB = (typeof holdB)[number];
export function isHoldB(input: string): boolean {
  return (holdB as readonly string[]).includes(input);
}

const modifierValues = [...burst, ...hold, ...holdB] as const;
export type Modifier = Burst | Hold | HoldB;
function isModifier(input: string): boolean {
  return (modifierValues as readonly string[]).includes(input.toLowerCase());
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

  let parsedModifier: Modifier | undefined;
  if (split.length > 0 && isModifier(split[0])) {
    parsedModifier = findModifier(split[0]);
    [, ...split] = split;
  }

  let parsedCommand: Command | undefined;
  if (split.length > 0) {
    parsedCommand = findCommand(split[0]);
    if (parsedCommand !== undefined) {
      [, ...split] = split;
    }
  }

  if (split.length === 0 && parsedCommand !== undefined) {
    return {
      command: parsedCommand,
      quantity,
      modifier: parsedModifier,
    };
  }

  return undefined;
}
