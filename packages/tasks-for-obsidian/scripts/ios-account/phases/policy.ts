import { z } from "zod";
import definition from "../account-input.schema.json";
import { AccountOperationSchema, type AccountOperation } from "../contract";

const Stage = z.enum(["credentials", "verification", "vaults", "connected"]);
const Phase = z.strictObject({
  initialStages: z.array(Stage).min(1),
  finishStages: z.array(Stage).min(1),
  allowedRunnerKinds: z.array(z.string()).min(1),
  allowedAppKinds: z.array(z.string()).min(1),
  runnerCommandLimit: z.number().int().min(1).max(13),
  appCommandLimit: z.number().int().min(1).max(7),
  maximumSubmissions: z.strictObject({
    credentials: z.number().int().min(0).max(1),
    verification: z.number().int().min(0).max(1),
    connect: z.number().int().min(0).max(1),
  }),
});
export const PhaseContract = z
  .strictObject({
    sessionSeconds: z.literal(120),
    operations: z.record(AccountOperationSchema, Phase),
  })
  .parse(definition.$defs["phase-contract"].const);
export function phasePolicy(operation: AccountOperation) {
  return PhaseContract.operations[operation];
}
