import { z } from "zod";

const ChartNameSchema = z.string().regex(/^[a-z0-9][a-z0-9-]*$/u);
const BuildRevisionSchema = z.string().regex(/^2\.0\.0-[1-9]\d*$/u);
const DigestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
// Delivery's artifact identifier shape; ops-model cannot import Delivery.
const ArtifactIdSchema = z
  .string()
  .min(1)
  .max(160)
  .regex(/^[a-z0-9][\w.:/-]*$/iu);

/** A chart whose archive this exact CI run packaged and pushed. */
export const PublishedChartReceiptSchema = z.strictObject({
  name: ChartNameSchema,
  revision: BuildRevisionSchema,
  digest: DigestSchema,
  /** Chart content identity with the version excluded, from fingerprintChart. */
  contentFingerprint: DigestSchema,
});
export type PublishedChartReceipt = z.infer<typeof PublishedChartReceiptSchema>;

/** An unchanged chart retained by reference to Delivery's qualified artifact. */
export const RetainedChartReceiptSchema = z.strictObject({
  name: ChartNameSchema,
  revision: BuildRevisionSchema,
  digest: DigestSchema,
  artifactId: ArtifactIdSchema,
  contentFingerprint: DigestSchema,
});
export type RetainedChartReceipt = z.infer<typeof RetainedChartReceiptSchema>;

/** Charts pushed by this exact CI run plus unchanged charts it retained by reference. */
export const ChartPublicationSchema = z
  .strictObject({
    schema: z.literal("delivery-chart-publications/v2"),
    sourceRevision: z.string().regex(/^[a-f0-9]{40}$/u),
    pipelineNumber: z.number().int().positive(),
    repositoryId: z.number().int().positive(),
    charts: z.array(PublishedChartReceiptSchema),
    retained: z.array(RetainedChartReceiptSchema),
  })
  .superRefine((receipt, context) => {
    const names = [...receipt.charts, ...receipt.retained].map(
      (chart) => chart.name,
    );
    if (new Set(names).size !== names.length)
      context.addIssue({
        code: "custom",
        message: "A chart may be published or retained only once per pipeline",
      });
  });
export type ChartPublication = z.infer<typeof ChartPublicationSchema>;
