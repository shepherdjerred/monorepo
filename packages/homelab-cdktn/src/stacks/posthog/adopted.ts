import path from "node:path";
import { z } from "zod";

const JsonObjectSchema = z.record(z.string(), z.json());

const AdoptedSchema = z.strictObject({
  dashboards: z.record(
    z.string(),
    z.strictObject({
      importId: z.string(),
      name: z.string(),
      description: z.string(),
      pinned: z.boolean(),
    }),
  ),
  layouts: z.record(
    z.string(),
    z.strictObject({
      importId: z.string(),
      dashboardId: z.number(),
      tiles: z.array(
        z.strictObject({
          color: z.string().optional(),
          insightId: z.number().optional(),
          showDescription: z.boolean().optional(),
          textBody: z.string().optional(),
          layouts: JsonObjectSchema.optional(),
        }),
      ),
    }),
  ),
  insights: z.record(
    z.string(),
    z.strictObject({
      importId: z.string(),
      name: z.string(),
      description: z.string().optional(),
      dashboardIds: z.array(z.number()),
      query: JsonObjectSchema,
    }),
  ),
  hogFunctions: z.record(
    z.string(),
    z.strictObject({
      importId: z.string(),
      name: z.string(),
      description: z.string(),
      type: z.string(),
      templateId: z.string(),
      iconUrl: z.string(),
      enabled: z.boolean(),
      executionOrder: z.number(),
      filters: JsonObjectSchema,
      hog: z.string(),
    }),
  ),
});

export type Adopted = z.infer<typeof AdoptedSchema>;

/**
 * The PostHog objects that existed before this stack and were imported into
 * it: dashboards, their tile layouts, insights and the GeoIP transformation.
 * `adopted.json` is their one source of truth. Each key is the object's
 * Terraform resource name, so renaming a key is a state change; `importId` is
 * the PostHog id its `import` block adopts.
 *
 * `query`, `layouts` and `filters` are the JSON documents PostHog stores.
 * They reach OpenTofu as objects and are encoded there with `jsonencode`,
 * which sorts keys, so key order in the file is free.
 */
export const ADOPTED: Adopted = AdoptedSchema.parse(
  await Bun.file(path.join(import.meta.dir, "adopted.json")).json(),
);
