import { z } from "zod";
import { AvailabilitySchema } from "#shared/contract.ts";

export const LibraryCursorSchema = z.object({
  title: z.string().max(1000),
  id: z.string().min(1).max(100),
});
export const LibraryQuerySchema = z
  .object({
    query: z.string().trim().max(200).default(""),
    kind: z.enum(["all", "movie", "series"]).default("all"),
    cursor: z.string().max(5000).nullable().default(null),
    limit: z.coerce.number().int().min(1).max(50).default(25),
  })
  .superRefine((value, context) => {
    if (value.cursor === null) return;
    try {
      LibraryCursorSchema.parse(JSON.parse(value.cursor));
    } catch {
      context.addIssue({
        code: "custom",
        path: ["cursor"],
        message: "Invalid library cursor",
      });
    }
  });
export type LibraryQuery = z.infer<typeof LibraryQuerySchema>;
export const LibraryPageSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.string(),
        title: z.string(),
        kind: z.enum(["movie", "series"]),
        year: z.int().nullable(),
        policy: z.enum(["keep", "temporary", "unclassified"]),
        myInterest: z.enum(["following", "released", "none"]),
        availability: AvailabilitySchema.nullable(),
        protection: z.enum([
          "keep_indefinitely",
          "temporary_interest",
          "review_required",
        ]),
        libraryKeeping: z
          .object({
            mediaVersion: z.int().nonnegative(),
            targetVersion: z.int().nonnegative(),
            keepingPolicy: z.enum(["keep", "temporary"]),
          })
          .nullable(),
      }),
    )
    .max(50),
  nextCursor: z.string().nullable(),
});
