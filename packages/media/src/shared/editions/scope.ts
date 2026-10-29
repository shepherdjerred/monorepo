import { z } from "zod";

export const DefaultEditionScopeSchema = z.strictObject({
  mediaId: z.uuid(),
  edition: z.literal("default"),
});

export type DefaultEditionScope = z.infer<typeof DefaultEditionScopeSchema>;

/** An absent edition in a validated historical contract means only this target. */
export function defaultScope(mediaId: string): DefaultEditionScope {
  return { mediaId, edition: "default" };
}

export function assertDefaultEdition(edition: string): void {
  if (!DefaultEditionScopeSchema.shape.edition.safeParse(edition).success)
    throw new Error("edition_not_available");
}

/** Select explicitly even when the relation was filtered by its caller. */
export function defaultIntent<T extends { edition: string }>(
  rows: readonly T[],
): T | null {
  const matches = rows.filter((row) => row.edition === "default");
  if (matches.length > 1) throw new Error("Duplicate default media target");
  return matches[0] ?? null;
}
