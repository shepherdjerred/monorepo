import { z } from "zod";
import type { HealthSample, HealthSetup, HealthStatus } from "./health-wire.ts";

export const healthNutrition = {
  foodLevel: z.number().int().min(0).max(20),
  saturation: z.number().min(0).max(20),
  difficulty: z.enum(["PEACEFUL", "EASY", "NORMAL", "HARD"]),
};
export const HealthEnvironment = z.strictObject({
  difficulty: z.literal("HARD"),
  foodLevel: z.literal(7),
  saturation: z.literal(0),
});

const journalNumber = z
  .string()
  .regex(/^(?:0|[1-9]\d*)(?:\.\d+)?(?:e[+-]?\d+)?$/iu)
  .transform(Number);
const EnvironmentEvidence = z.strictObject({
  difficulty: healthNutrition.difficulty,
  foodLevel: journalNumber.pipe(healthNutrition.foodLevel),
  saturation: journalNumber.pipe(healthNutrition.saturation),
  originalDifficulty: healthNutrition.difficulty,
  originalFoodLevel: journalNumber.pipe(healthNutrition.foodLevel),
  originalSaturation: journalNumber.pipe(healthNutrition.saturation),
  directHealthChange: z.literal("false"),
  source: z.literal("explicit-controlled-diagnostic-environment"),
});
type State = z.infer<typeof HealthStatus>;
type Nutrition = Pick<
  z.infer<typeof HealthSample>,
  "difficulty" | "foodLevel" | "saturation"
>;

function originalNutrition(evidence: z.infer<typeof EnvironmentEvidence>) {
  return {
    difficulty: evidence.originalDifficulty,
    foodLevel: evidence.originalFoodLevel,
    saturation: evidence.originalSaturation,
  };
}

function sameNutrition(actual: Nutrition | undefined, expected: Nutrition) {
  return (
    actual?.difficulty === expected.difficulty &&
    actual.foodLevel === expected.foodLevel &&
    actual.saturation === expected.saturation
  );
}

/** The actual trials, not just an unrelated snapshot, must use the reversible environment. */
export function validateEnvironment(
  status: State,
  expected: z.infer<typeof HealthEnvironment>,
) {
  const controlled = status.setups.filter(
    (row) => row.kind === "environment-control",
  );
  const restored = status.setups.filter(
    (row) => row.kind === "environment-restored",
  );
  const start = controlled[0];
  const finish = restored[0];
  if (
    start === undefined ||
    finish === undefined ||
    controlled.length !== 1 ||
    restored.length !== 1 ||
    start.sequence >= finish.sequence
  )
    throw new Error(
      "Controlled health environment lacks its original setup and restoration",
    );
  const before = EnvironmentEvidence.parse(start.details);
  const after = EnvironmentEvidence.parse(finish.details);
  const original = originalNutrition(before);
  if (
    !sameNutrition(before, expected) ||
    !sameNutrition(after, original) ||
    !sameNutrition(originalNutrition(after), original)
  )
    throw new Error(
      "Controlled health environment was not read back and restored exactly",
    );
  const trials = status.samples.filter(
    (row) => row.sequence > start.sequence && row.sequence < finish.sequence,
  );
  const final = status.samples.find((row) => row.sequence > finish.sequence);
  if (
    trials.length === 0 ||
    trials.some((row) => !sameNutrition(row, expected)) ||
    !sameNutrition(final, after)
  )
    throw new Error(
      "Native captures differ from the controlled and restored health environment",
    );
  validateControlledWindow(status, start, finish);
  const lastControlled = trials.at(-1);
  if (
    final?.health !== lastControlled?.health ||
    final?.absorption !== lastControlled?.absorption
  )
    throw new Error(
      "Health changed while restoring the diagnostic environment",
    );
  if (status.regains.length > 0)
    throw new Error(
      "Controlled cumulative health trial still received native healing",
    );
}

function validateControlledWindow(
  status: State,
  start: z.infer<typeof HealthSetup>,
  finish: z.infer<typeof HealthSetup>,
) {
  const outside = (sequence: number) =>
    sequence <= start.sequence || sequence >= finish.sequence;
  if (
    status.predictions.some(
      (row) => outside(row.sequence) || outside(row.sourceSequence),
    ) ||
    status.falls.some(
      (row) =>
        outside(row.sequence) ||
        row.eventTick < start.serverTick ||
        row.observedTick > finish.serverTick,
    )
  )
    throw new Error(
      "Native trials were not performed within their controlled environment",
    );
}
