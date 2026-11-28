import { z } from "zod";
import { PlexDecimalIdSchema } from "#shared/plex-events/contract.ts";

export const CollectionMembershipSchema = z.strictObject({
  ratingKey: PlexDecimalIdSchema,
  guid: z.string().min(1).max(2048),
});
export type CollectionMembership = z.infer<typeof CollectionMembershipSchema>;

/** An open Media decision can add an absent item. Only a recorded Media addition can leave. */
export function nextCollectionChange(
  desired: readonly CollectionMembership[],
  owned: readonly CollectionMembership[],
  present: ReadonlySet<string>,
  protectedKeys?: ReadonlySet<string>,
) {
  const wanted = new Set(desired.map((item) => item.ratingKey));
  const remove = owned.find(
    (item) =>
      protectedKeys?.has(item.ratingKey) !== true &&
      !wanted.has(item.ratingKey) &&
      present.has(item.ratingKey),
  );
  if (remove !== undefined) return { item: remove, present: false };
  const add = desired.find(
    (item) =>
      protectedKeys?.has(item.ratingKey) !== true &&
      !present.has(item.ratingKey),
  );
  return add === undefined ? null : { item: add, present: true };
}
