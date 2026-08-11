import { z } from "zod/v4";

export const AgentTaskEvidenceCriteriaV2Schema = z
  .array(
    z.object({
      field: z.enum(["source", "command", "url", "excerpt"]),
      includes: z.string().min(1),
    }),
  )
  .min(1);

export const AgentTaskEvidenceCollectorV2Schema = z.discriminatedUnion("kind", [
  z.object({
    id: z
      .string()
      .min(1)
      .regex(/^[a-z0-9][a-z0-9-]*$/),
    kind: z.literal("command"),
    argv: z.array(z.string().min(1)).min(1).max(64),
    output: z.enum(["allow-empty", "non-empty", "json"]),
    successExitCodes: z
      .array(z.number().int().min(0).max(255))
      .min(1)
      .optional(),
  }),
  z.object({
    id: z
      .string()
      .min(1)
      .regex(/^[a-z0-9][a-z0-9-]*$/),
    kind: z.literal("prometheus"),
    query: z.string().min(1),
    windowSeconds: z.number().int().positive().max(604_800).optional(),
    stepSeconds: z.number().int().positive().max(3600).optional(),
  }),
]);

export type AgentTaskEvidenceCollectorV2 = z.infer<
  typeof AgentTaskEvidenceCollectorV2Schema
>;

export const AgentTaskEvidenceCollectorsV2Schema = z
  .array(AgentTaskEvidenceCollectorV2Schema)
  .min(1)
  .superRefine((collectors, ctx) => {
    const ids = collectors.map((collector) => collector.id);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({
        code: "custom",
        message: "evidence collector ids must be unique within a check",
      });
    }
  });

export function agentTaskCollectorReceiptId(
  checkId: string,
  collectorId: string,
): string {
  return `collector:${checkId}:${collectorId}`;
}
