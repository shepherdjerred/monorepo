import { z } from "zod";
import { IdentifierSchema } from "./artifact-contract.ts";

/** Frozen archive activation policy shared by standalone sites and Scout releases. */
export const StaticSitePolicySchema = z
  .object({
    archiveComponent: IdentifierSchema,
    bucket: z.string().regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/),
    immutablePrefixes: z.array(z.string()).default([]),
    extraExcludes: z.array(z.string()).default([]),
    entrypoints: z.array(z.string().min(1)).min(1).default(["index.html"]),
    verification: z.object({
      url: z.url(),
      expectedStatus: z.number().int().min(200).max(299),
    }),
    cloudflareZoneId: z
      .string()
      .regex(/^[a-f0-9]{32}$/)
      .optional(),
  })
  .strict();

export type StaticSitePolicy = z.infer<typeof StaticSitePolicySchema>;
