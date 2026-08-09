import { Temporal } from "@js-temporal/polyfill";
import { z } from "zod";

export const InstantTextSchema = z
  .string()
  .refine((value) => {
    try {
      Temporal.Instant.from(value);
      return true;
    } catch {
      return false;
    }
  }, "Expected an RFC 3339 instant")
  .brand<"InstantText">();

export type InstantText = z.infer<typeof InstantTextSchema>;

export type Clock = {
  now: () => Temporal.Instant;
};

export const systemClock: Clock = {
  now: () => Temporal.Now.instant(),
};

export function fixedClock(value: string): Clock {
  const instant = Temporal.Instant.from(InstantTextSchema.parse(value));
  return { now: () => instant };
}

export function instantTextToEpochNanoseconds(value: InstantText): bigint {
  return Temporal.Instant.from(value).epochNanoseconds;
}

export function epochNanosecondsToInstantText(value: bigint): InstantText {
  return InstantTextSchema.parse(
    Temporal.Instant.fromEpochNanoseconds(value).toString(),
  );
}

export function addDuration(
  value: bigint,
  duration: Temporal.DurationLike,
): bigint {
  return Temporal.Instant.fromEpochNanoseconds(value).add(duration)
    .epochNanoseconds;
}

export function durationMilliseconds(from: bigint, to: bigint): number {
  return Number((to - from) / 1_000_000n);
}
