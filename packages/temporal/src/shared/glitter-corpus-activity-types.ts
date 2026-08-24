import { z } from "zod/v4";
import {
  GuildInventorySchema,
  StoredObjectSchema,
  PageManifestSchema,
} from "#shared/glitter-corpus.ts";

export const CapturePageInputSchema = z
  .object({
    requestId: z.uuid(),
    guildId: z.string().regex(/^\d+$/),
    guildSlug: z.string().min(1),
    channelId: z.string().regex(/^\d+$/),
    direction: z.enum(["backward", "forward", "daily-overlap"]),
    before: z.string().regex(/^\d+$/).optional(),
    after: z.string().regex(/^\d+$/).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.before !== undefined && value.after !== undefined) {
      context.addIssue({
        code: "custom",
        message: "capture page cannot set before and after",
      });
    }
  });
export type CapturePageInput = z.input<typeof CapturePageInputSchema>;

export const CapturePageResultSchema = z
  .object({
    manifestKey: z.string().min(1),
    manifestObject: StoredObjectSchema,
    page: PageManifestSchema,
    messageIds: z.array(z.string().regex(/^\d+$/)),
    messageTimestamps: z.array(z.iso.datetime({ offset: true })),
  })
  .strict();
export type CapturePageResult = z.infer<typeof CapturePageResultSchema>;

const ChannelVerificationIdentitySchema = z.strictObject({
  snapshotId: z.uuid(),
  guildId: z.string().regex(/^\d+$/),
  guildSlug: z.string().min(1),
  channelId: z.string().regex(/^\d+$/),
  verifiedAt: z.iso.datetime({ offset: true }),
});

export const VerifyChannelInputSchema =
  ChannelVerificationIdentitySchema.extend({
    backwardPageManifestKeys: z.array(z.string().min(1)).min(1),
    forwardPageManifestKeys: z.array(z.string().min(1)).min(1),
    forwardUpperBoundMessageId: z.string().regex(/^\d+$/).optional(),
    seedPrefix: z.string().min(1).optional(),
    retainedBaselineManifestKey: z.string().min(1).optional(),
  });

export const ChannelStateResultSchema = z
  .object({
    channelId: z.string().regex(/^\d+$/),
    manifestKey: z.string().min(1),
    manifestObject: StoredObjectSchema,
    uniqueMessageCount: z.number().int().nonnegative(),
  })
  .strict();
export type ChannelStateResult = z.infer<typeof ChannelStateResultSchema>;

export const ApplyOverlapInputSchema = ChannelVerificationIdentitySchema.extend(
  {
    baselineManifestKey: z.string().min(1),
    baselineNewestMessageId: z.string().regex(/^\d+$/).nullable(),
    pageManifestKeys: z.array(z.string().min(1)).min(1),
    overlapCutoff: z.iso.datetime({ offset: true }),
    stoppedBecause: z.enum(["cutoff-reached", "empty-channel"]),
  },
);

export const FinalizeSnapshotInputSchema = z
  .object({
    snapshotId: z.uuid(),
    guildId: z.string().regex(/^\d+$/),
    createdAt: z.iso.datetime({ offset: true }),
    inventoryObject: StoredObjectSchema,
    expectedChannelIds: z.array(z.string().regex(/^\d+$/)),
    channelStates: z.array(ChannelStateResultSchema),
  })
  .strict();

export const InventoryResultSchema = z
  .object({
    inventory: GuildInventorySchema,
    inventoryKey: z.string().min(1),
    inventoryObject: StoredObjectSchema,
  })
  .strict();
export type InventoryResult = z.infer<typeof InventoryResultSchema>;

export const DailyBaselineSchema = z
  .object({
    inventory: GuildInventorySchema,
    inventoryObject: StoredObjectSchema,
    states: z.record(
      z.string().regex(/^\d+$/),
      z
        .object({
          manifestKey: z.string().min(1),
          manifestObject: StoredObjectSchema,
          uniqueMessageCount: z.number().int().nonnegative(),
          newestMessageId: z.string().regex(/^\d+$/).nullable(),
          lineageDepth: z.number().int().nonnegative(),
          seedPrefix: z.string().min(1).nullable(),
        })
        .strict(),
    ),
  })
  .strict();
export type DailyBaseline = z.infer<typeof DailyBaselineSchema>;
