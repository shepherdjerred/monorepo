import { z } from "zod";

/** Immutable journal shared by control-plane replacement and content recovery. */
export const DispatchBarrierSchema = z.strictObject({
  adapter: z.literal("control-plane-dispatch-barrier/v1"),
  deploymentUID: z.string().min(1),
  templateFingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
  priorReplicas: z.literal(1),
  podUIDs: z.array(z.string()).min(1),
  replicaSetUIDs: z.array(z.string()).min(1),
});
