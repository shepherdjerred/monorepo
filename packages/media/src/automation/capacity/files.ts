import type { Database } from "#infrastructure/database.ts";
import {
  CAPACITY_ROOTS,
  CapacityCycleSchema,
  type CapacityCycle,
  type CapacityRole,
  type CapacitySampleActivityResult,
  type CapacitySampleResult,
  type CapacityBinding,
} from "#shared/capacity/contract.ts";
import { createCapacityRootIO, type CapacityRootIO } from "./io.ts";
import { beginCapacitySample, finishCapacitySample } from "./sample.ts";
import { checkpoint, type CapacityExecution } from "./execution.ts";

type CapacityFileContext = {
  db: Database;
  enabled: () => Promise<boolean>;
  roots: Record<CapacityRole, string>;
  workerPodUid: string;
  io?: CapacityRootIO;
};

async function sampleBoundRoot(
  context: CapacityFileContext,
  binding: CapacityBinding,
  io: CapacityRootIO,
  execution: CapacityExecution,
): Promise<CapacitySampleResult> {
  if (context.roots[binding.role] !== CAPACITY_ROOTS[binding.role])
    return { status: "unavailable", reason: "root_configuration_mismatch" };
  return binding.workerPodUid === context.workerPodUid
    ? await io.sample(binding.role, execution)
    : { status: "unavailable", reason: "worker_mismatch" };
}

export function createCapacityFileProducer(context: CapacityFileContext) {
  const io =
    context.io ??
    createCapacityRootIO({ resolve: (role) => context.roots[role] });
  return async (
    raw: CapacityCycle,
    execution: CapacityExecution,
  ): Promise<CapacitySampleActivityResult> => {
    await checkpoint(execution);
    if (!(await context.enabled()))
      return { status: "disabled", sampled: 0, unavailable: 0 };
    await checkpoint(execution);
    const cycle = CapacityCycleSchema.parse(raw);
    const start = await beginCapacitySample(context.db, cycle, execution);
    if (start.status === "superseded")
      return { status: "superseded", sampled: 0, unavailable: 0 };
    let sampled = 0;
    let unavailable = 0;
    for (const role of start.roles) {
      await checkpoint(execution);
      if (role.status === "unavailable") {
        unavailable++;
        continue;
      }
      const name = role.token.role;
      const result = await sampleBoundRoot(
        context,
        role.binding,
        io,
        execution,
      );
      await checkpoint(execution);
      if (
        (await finishCapacitySample(
          context.db,
          role.token,
          result,
          execution,
        )) === "superseded"
      )
        return { status: "superseded", sampled: 0, unavailable: 0 };
      // A proof may expire during IO; report the stored outcome, not the measurement.
      const saved = await context.db.mediaCapacityObservation.findUniqueOrThrow(
        { where: { role: name } },
      );
      await checkpoint(execution);
      if (
        saved.sampleResultAttempt !== BigInt(role.token.sampleAttempt) ||
        saved.cycleRevision !== BigInt(role.token.cycleRevision)
      )
        return { status: "superseded", sampled: 0, unavailable: 0 };
      if (saved.sampleOutcome === "observed") sampled++;
      else unavailable++;
    }
    return { status: "completed", sampled, unavailable };
  };
}
