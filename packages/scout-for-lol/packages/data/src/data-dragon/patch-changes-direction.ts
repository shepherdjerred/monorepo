// Direction of a balance line, derived deterministically from its numbers.
//
// A line is "buff" or "nerf" only when before and after have the same shape
// (the same text once the numbers are blanked out) and every number moved the
// same way, adjusted for stats where a lower value is stronger. Anything else —
// different shape, no numbers, no change, some numbers up and some down — is
// "adjust". Nothing here guesses at meaning beyond that.

import { z } from "zod";

export const PatchChangeDirectionSchema = z.enum(["buff", "nerf", "adjust"]);
export type PatchChangeDirection = z.infer<typeof PatchChangeDirectionSchema>;

/**
 * Stats where a smaller number is the stronger one. "Refund" and "reduction"
 * stats are the opposite (a bigger refund helps), so they are excluded first.
 */
const LOWER_IS_BETTER =
  /\b(?:cooldowns?|costs?|cast time|cast delay|wind-?up|recipe|recharge time|channel time)\b/i;
const HIGHER_IS_BETTER_OVERRIDE = /\b(?:refunds?|refunded|reduction)\b/i;

export function isLowerBetter(stat: string): boolean {
  return LOWER_IS_BETTER.test(stat) && !HIGHER_IS_BETTER_OVERRIDE.test(stat);
}

// A minus sign is a sign only when it does not follow a digit or a closing
// bracket, so ranges such as "70-160" read as two positive numbers.
const NUMBER = /(?<![\d.)%])-?\d+(?:\.\d+)?|\d+(?:\.\d+)?/g;

type Numeric = { shape: string; numbers: number[] };

function readNumbers(text: string): Numeric {
  const numbers: number[] = [];
  const shape = text
    .replaceAll(NUMBER, (match) => {
      numbers.push(Number(match));
      return "#";
    })
    .replaceAll(/\s+/g, " ")
    .trim();
  return { shape, numbers };
}

type Movement = "up" | "down" | "mixed" | "none";

function movement(before: readonly number[], after: readonly number[]) {
  let up = false;
  let down = false;
  for (const [index, previous] of before.entries()) {
    const next = after[index];
    if (next === undefined) {
      return "mixed";
    }
    if (next > previous) {
      up = true;
    } else if (next < previous) {
      down = true;
    }
  }
  if (up === down) {
    return up ? "mixed" : "none";
  }
  return up ? "up" : "down";
}

export function directionOfChange(
  stat: string,
  before: string,
  after: string,
): PatchChangeDirection {
  const previous = readNumbers(before);
  const next = readNumbers(after);
  if (
    previous.numbers.length === 0 ||
    previous.numbers.length !== next.numbers.length ||
    previous.shape !== next.shape
  ) {
    return "adjust";
  }
  const moved: Movement = movement(previous.numbers, next.numbers);
  if (moved === "mixed" || moved === "none") {
    return "adjust";
  }
  // "50% Less" is a penalty: a bigger number is the weaker value.
  const lowerIsStronger =
    isLowerBetter(stat) !== /\bless\b/i.test(previous.shape);
  const strengthened = lowerIsStronger ? moved === "down" : moved === "up";
  return strengthened ? "buff" : "nerf";
}

/**
 * A subject's direction across the lines of one patch: buff or nerf only when
 * every line agrees, otherwise adjust.
 */
export function overallDirection(
  directions: readonly PatchChangeDirection[],
): PatchChangeDirection {
  const [first] = directions;
  if (first === undefined) {
    throw new Error("A subject needs at least one change line");
  }
  return directions.every((direction) => direction === first)
    ? first
    : "adjust";
}
