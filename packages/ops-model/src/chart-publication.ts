import { z } from "zod";

/** Only charts packaged and successfully pushed by this exact CI run. */
export const ChartPublicationSchema = z
  .strictObject({
    schema: z.literal("delivery-chart-publications/v1"),
    sourceRevision: z.string().regex(/^[a-f0-9]{40}$/u),
    pipelineNumber: z.number().int().positive(),
    repositoryId: z.number().int().positive(),
    charts: z.array(
      z.strictObject({
        name: z.string().regex(/^[a-z0-9][a-z0-9-]*$/u),
        revision: z.string().regex(/^2\.0\.0-[1-9]\d*$/u),
        digest: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
      }),
    ),
  })
  .superRefine((receipt, context) => {
    if (
      new Set(receipt.charts.map((chart) => chart.name)).size !==
      receipt.charts.length
    )
      context.addIssue({
        code: "custom",
        message: "A chart may be published only once per pipeline",
      });
  });
export type ChartPublication = z.infer<typeof ChartPublicationSchema>;
