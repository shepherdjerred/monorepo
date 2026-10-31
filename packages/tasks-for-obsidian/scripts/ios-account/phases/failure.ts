import { z } from "zod";

export const FailureKind = z.enum([
  "deadline",
  "ownership",
  "form",
  "focus",
  "socket",
  "protocol",
  "intent",
  "broker",
  "backend",
  "native",
  "authority",
  "retention",
  "cleanup",
  "internal",
]);
export const InputPhase = z.enum([
  "prepare",
  "owner",
  "credentials",
  "verification",
  "vault-password",
  "connect",
  "finish",
  "retention",
  "cleanup",
]);
export type InputPhase = z.infer<typeof InputPhase>;
export function phaseTiming(
  started: number,
  deadline: number,
  now = performance.now(),
) {
  return {
    elapsedMilliseconds: Math.max(0, Math.round(now - started)),
    deadlineRemainingMilliseconds: Math.round(deadline - now),
  };
}
export class PrivatePhaseFailure extends Error {
  constructor(
    readonly kind: z.infer<typeof FailureKind>,
    readonly phase: InputPhase,
  ) {
    super("Private iOS phase stopped");
  }
}
export function closedFailure(
  error: unknown,
  fallback: { kind: z.infer<typeof FailureKind>; phase: InputPhase },
  timing: {
    elapsedMilliseconds: number;
    deadlineRemainingMilliseconds: number;
  },
) {
  return z
    .strictObject({
      kind: FailureKind,
      phase: InputPhase,
      elapsedMilliseconds: z.number().int().nonnegative(),
      deadlineRemainingMilliseconds: z.number().int(),
    })
    .parse({
      kind: error instanceof PrivatePhaseFailure ? error.kind : fallback.kind,
      phase:
        error instanceof PrivatePhaseFailure ? error.phase : fallback.phase,
      elapsedMilliseconds: Math.max(0, Math.round(timing.elapsedMilliseconds)),
      deadlineRemainingMilliseconds: Math.round(
        timing.deadlineRemainingMilliseconds,
      ),
    });
}
