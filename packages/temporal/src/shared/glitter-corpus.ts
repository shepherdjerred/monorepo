import { z } from "zod/v4";

export const DiscordSnowflakeSchema = z.string().regex(/^\d+$/);
export const IsoTimestampSchema = z.iso.datetime({ offset: true });
export const Sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);

export const CorpusSourceSchema = z.enum(["seed", "discord-rest"]);
export type CorpusSource = z.infer<typeof CorpusSourceSchema>;

export const DiscordAttachmentSchema = z
  .object({
    id: DiscordSnowflakeSchema,
    filename: z.string(),
    size: z.number().int().nonnegative(),
    url: z.url(),
    proxyUrl: z.url(),
    contentType: z.string().nullable(),
    height: z.number().int().nonnegative().nullable(),
    width: z.number().int().nonnegative().nullable(),
    description: z.string().nullable(),
    ephemeral: z.boolean(),
  })
  .strict();
export type DiscordAttachment = z.infer<typeof DiscordAttachmentSchema>;

export const DiscordAuthorSchema = z
  .object({
    id: DiscordSnowflakeSchema,
    username: z.string(),
    globalName: z.string().nullable(),
    discriminator: z.string(),
    bot: z.boolean(),
    avatar: z.string().nullable(),
  })
  .strict();
export type DiscordAuthor = z.infer<typeof DiscordAuthorSchema>;

export const CorpusObservationSchema = z
  .object({
    schemaVersion: z.literal(1),
    source: CorpusSourceSchema,
    sourceKey: z.string().min(1),
    observedAt: IsoTimestampSchema,
    guildId: DiscordSnowflakeSchema.nullable(),
    guildSlug: z.string().min(1),
    channelId: DiscordSnowflakeSchema,
    messageId: DiscordSnowflakeSchema,
    author: DiscordAuthorSchema,
    content: z.string(),
    timestamp: IsoTimestampSchema,
    editedTimestamp: IsoTimestampSchema.nullable(),
    type: z.number().int().nonnegative(),
    flags: z.string(),
    pinned: z.boolean(),
    tts: z.boolean(),
    attachments: z.array(DiscordAttachmentSchema),
    referencedMessageId: DiscordSnowflakeSchema.nullable(),
    raw: z.record(z.string(), z.unknown()),
  })
  .strict();
export type CorpusObservation = z.infer<typeof CorpusObservationSchema>;

export const CurrentMessageSchema = CorpusObservationSchema.omit({
  sourceKey: true,
  observedAt: true,
  raw: true,
}).extend({
  selectedObservationKey: z.string().min(1),
  selectedObservedAt: IsoTimestampSchema,
  rawSha256: Sha256Schema,
});
export type CurrentMessage = z.infer<typeof CurrentMessageSchema>;

export const DiscordChannelTypeSchema = z.union([
  z.literal(0),
  z.literal(2),
  z.literal(4),
  z.literal(5),
  z.literal(10),
  z.literal(11),
  z.literal(12),
  z.literal(13),
  z.literal(14),
  z.literal(15),
  z.literal(16),
]);
export type DiscordChannelType = z.infer<typeof DiscordChannelTypeSchema>;

export const CorpusScopeDecisionSchema = z.enum([
  "include",
  "exclude-denylist",
  "exclude-private-thread",
  "exclude-non-message-channel",
  "exclude-no-history-permission",
]);
export type CorpusScopeDecision = z.infer<typeof CorpusScopeDecisionSchema>;

export const ChannelInventoryEntrySchema = z
  .object({
    guildId: DiscordSnowflakeSchema,
    channelId: DiscordSnowflakeSchema,
    parentId: DiscordSnowflakeSchema.nullable(),
    name: z.string(),
    type: DiscordChannelTypeSchema,
    archived: z.boolean(),
    locked: z.boolean(),
    scopeDecision: CorpusScopeDecisionSchema,
    discoveredAt: IsoTimestampSchema,
  })
  .strict();
export type ChannelInventoryEntry = z.infer<typeof ChannelInventoryEntrySchema>;

export const GuildInventorySchema = z
  .object({
    schemaVersion: z.literal(1),
    guildId: DiscordSnowflakeSchema,
    guildSlug: z.string().min(1),
    guildName: z.string(),
    discoveredAt: IsoTimestampSchema,
    denylistedChannelIds: z.array(DiscordSnowflakeSchema),
    entries: z.array(ChannelInventoryEntrySchema),
    sha256: Sha256Schema,
  })
  .strict();
export type GuildInventory = z.infer<typeof GuildInventorySchema>;

export const TraversalDirectionSchema = z.enum([
  "backward",
  "forward",
  "daily-overlap",
]);
export type TraversalDirection = z.infer<typeof TraversalDirectionSchema>;

export const DiscordRateLimitSchema = z
  .object({
    limit: z.number().int().nonnegative().nullable(),
    remaining: z.number().int().nonnegative().nullable(),
    resetAfterSeconds: z.number().nonnegative().nullable(),
    bucket: z.string().nullable(),
  })
  .strict();

export const PageManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    requestId: z.uuid(),
    guildId: DiscordSnowflakeSchema,
    channelId: DiscordSnowflakeSchema,
    direction: TraversalDirectionSchema,
    before: DiscordSnowflakeSchema.nullable(),
    after: DiscordSnowflakeSchema.nullable(),
    requestedAt: IsoTimestampSchema,
    completedAt: IsoTimestampSchema,
    responseCount: z.number().int().min(0).max(100),
    firstMessageId: DiscordSnowflakeSchema.nullable(),
    lastMessageId: DiscordSnowflakeSchema.nullable(),
    rawObjectKey: z.string().min(1),
    rawSha256: Sha256Schema,
    retryCount: z.number().int().nonnegative(),
    rateLimit: DiscordRateLimitSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.before !== null && value.after !== null) {
      context.addIssue({
        code: "custom",
        message: "page manifest cannot set both before and after",
      });
    }
    if (value.direction === "forward" && value.before !== null) {
      context.addIssue({
        code: "custom",
        message: "forward page manifest cannot set before",
      });
    }
    if (value.direction !== "forward" && value.after !== null) {
      context.addIssue({
        code: "custom",
        message: `${value.direction} page manifest cannot set after`,
      });
    }
    const hasNoBoundaries =
      value.firstMessageId === null && value.lastMessageId === null;
    if ((value.responseCount === 0) !== hasNoBoundaries) {
      context.addIssue({
        code: "custom",
        message:
          "page message boundaries must both be null exactly when the response is empty",
      });
    }
  });
export type PageManifest = z.infer<typeof PageManifestSchema>;

export const TraversalProofSchema = z
  .object({
    direction: z.enum(["backward", "forward"]),
    pageManifestKeys: z.array(z.string().min(1)).min(1),
    terminalPageManifestKey: z.string().min(1),
    terminalResponseCount: z.number().int().min(0).max(100),
    terminalReason: z.enum(["empty-channel", "reached-upper-bound"]),
    upperBoundMessageId: DiscordSnowflakeSchema.nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.terminalReason === "empty-channel" &&
      value.terminalResponseCount !== 0
    ) {
      context.addIssue({
        code: "custom",
        message:
          "empty-channel traversal proof requires an empty terminal page",
      });
    }
    if (
      value.terminalReason === "reached-upper-bound" &&
      (value.direction !== "forward" ||
        value.terminalResponseCount === 0 ||
        value.upperBoundMessageId === null)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "reached-upper-bound requires a non-empty forward page and a frozen upper bound",
      });
    }
    if (value.direction === "backward" && value.upperBoundMessageId !== null) {
      context.addIssue({
        code: "custom",
        message: "backward traversal proof cannot set an upper bound",
      });
    }
  });
export type TraversalProof = z.infer<typeof TraversalProofSchema>;

function validateProjectionBounds(
  value: {
    uniqueMessageCount: number;
    oldestMessageId: string | null;
    newestMessageId: string | null;
  },
  context: z.core.$RefinementCtx,
): void {
  const hasNoBounds =
    value.oldestMessageId === null && value.newestMessageId === null;
  if ((value.uniqueMessageCount === 0) !== hasNoBounds) {
    context.addIssue({
      code: "custom",
      message:
        "projection bounds must both be null exactly when the projection is empty",
    });
  }
  if (
    value.oldestMessageId !== null &&
    value.newestMessageId !== null &&
    BigInt(value.oldestMessageId) > BigInt(value.newestMessageId)
  ) {
    context.addIssue({
      code: "custom",
      message: "oldest message ID must not exceed newest message ID",
    });
  }
}

const ChannelStateBaseSchema = z.object({
  schemaVersion: z.literal(1),
  snapshotId: z.uuid(),
  guildId: DiscordSnowflakeSchema,
  channelId: DiscordSnowflakeSchema,
  verifiedAt: IsoTimestampSchema,
  observationCount: z.number().int().nonnegative(),
  uniqueMessageCount: z.number().int().nonnegative(),
  oldestMessageId: DiscordSnowflakeSchema.nullable(),
  newestMessageId: DiscordSnowflakeSchema.nullable(),
  projectionObjectKey: z.string().min(1),
  projectionSha256: Sha256Schema,
  complete: z.literal(true),
});

export const ChannelCompletenessManifestSchema = ChannelStateBaseSchema.extend({
  backwardProof: TraversalProofSchema,
  forwardProof: TraversalProofSchema,
  seedPrefix: z.string().min(1).nullable(),
  seedObservationCount: z.number().int().nonnegative(),
  duplicateObservationCount: z.number().int().nonnegative(),
})
  .strict()
  .superRefine(validateProjectionBounds);
export type ChannelCompletenessManifest = z.infer<
  typeof ChannelCompletenessManifestSchema
>;

export const ChannelOverlapManifestSchema = ChannelStateBaseSchema.extend({
  baselineManifestKey: z.string().min(1),
  overlapPageManifestKeys: z.array(z.string().min(1)).min(1),
  overlapCutoff: IsoTimestampSchema,
  baselineNewestMessageId: DiscordSnowflakeSchema.nullable(),
  oldestObservedTimestamp: IsoTimestampSchema.nullable(),
  oldestObservedMessageId: DiscordSnowflakeSchema.nullable(),
  stoppedBecause: z.enum(["cutoff-reached", "empty-channel"]),
})
  .strict()
  .superRefine((value, context) => {
    validateProjectionBounds(value, context);
    if (
      value.stoppedBecause === "cutoff-reached" &&
      (value.oldestObservedTimestamp === null ||
        value.oldestObservedTimestamp > value.overlapCutoff)
    ) {
      context.addIssue({
        code: "custom",
        message: "cutoff-reached requires an observation at or before cutoff",
      });
    }
    if (
      value.stoppedBecause === "cutoff-reached" &&
      value.baselineNewestMessageId !== null &&
      (value.oldestObservedMessageId === null ||
        BigInt(value.oldestObservedMessageId) >
          BigInt(value.baselineNewestMessageId))
    ) {
      context.addIssue({
        code: "custom",
        message:
          "cutoff-reached must cross the previous snapshot's newest message ID",
      });
    }
  });
export type ChannelOverlapManifest = z.infer<
  typeof ChannelOverlapManifestSchema
>;

export const ChannelStateManifestSchema = z.union([
  ChannelCompletenessManifestSchema,
  ChannelOverlapManifestSchema,
]);
export type ChannelStateManifest = z.infer<typeof ChannelStateManifestSchema>;

export const MirrorObjectReceiptSchema = z
  .object({
    store: z.enum(["seaweedfs", "r2"]),
    bucket: z.string().min(1),
    key: z.string().min(1),
    sha256: Sha256Schema,
    etag: z.string().min(1),
    writtenAt: IsoTimestampSchema,
  })
  .strict();
export type MirrorObjectReceipt = z.infer<typeof MirrorObjectReceiptSchema>;

export const MirroredObjectSchema = z
  .object({
    key: z.string().min(1),
    sha256: Sha256Schema,
    receipts: z.tuple([MirrorObjectReceiptSchema, MirrorObjectReceiptSchema]),
  })
  .strict()
  .superRefine((value, context) => {
    const stores = new Set(value.receipts.map((receipt) => receipt.store));
    if (!stores.has("seaweedfs") || !stores.has("r2")) {
      context.addIssue({
        code: "custom",
        message: "mirrored object must have one SeaweedFS and one R2 receipt",
      });
    }
    for (const receipt of value.receipts) {
      if (receipt.key !== value.key || receipt.sha256 !== value.sha256) {
        context.addIssue({
          code: "custom",
          message: "mirror receipt key and checksum must match the object",
        });
      }
    }
  });
export type MirroredObject = z.infer<typeof MirroredObjectSchema>;

export const GuildSnapshotSchema = z
  .object({
    schemaVersion: z.literal(1),
    snapshotId: z.uuid(),
    guildId: DiscordSnowflakeSchema,
    createdAt: IsoTimestampSchema,
    inventoryObject: MirroredObjectSchema,
    channelManifestObjects: z.array(MirroredObjectSchema),
    expectedChannelIds: z.array(DiscordSnowflakeSchema),
    completeChannelIds: z.array(DiscordSnowflakeSchema),
    uniqueMessageCount: z.number().int().nonnegative(),
    complete: z.literal(true),
  })
  .strict()
  .superRefine((value, context) => {
    const expected = value.expectedChannelIds.toSorted();
    const complete = value.completeChannelIds.toSorted();
    if (
      new Set(value.expectedChannelIds).size !==
        value.expectedChannelIds.length ||
      new Set(value.completeChannelIds).size !== value.completeChannelIds.length
    ) {
      context.addIssue({
        code: "custom",
        message: "snapshot channel IDs must be unique",
      });
    }
    if (JSON.stringify(expected) !== JSON.stringify(complete)) {
      context.addIssue({
        code: "custom",
        message: "every expected channel must have a completeness manifest",
      });
    }
  });
export type GuildSnapshot = z.infer<typeof GuildSnapshotSchema>;

export const SeedImportManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    importedAt: IsoTimestampSchema,
    archivePath: z.string().min(1),
    archiveSha256: Sha256Schema,
    csvFileCount: z.number().int().positive(),
    observationCount: z.number().int().positive(),
    uniqueMessageCount: z.number().int().positive(),
    duplicateMessageCount: z.number().int().nonnegative(),
    firstTimestamp: IsoTimestampSchema,
    lastTimestamp: IsoTimestampSchema,
    guildSlugs: z.array(z.string().min(1)),
    channelIds: z.array(DiscordSnowflakeSchema),
    authorIds: z.array(DiscordSnowflakeSchema),
    projectionSha256: Sha256Schema,
  })
  .strict();
export type SeedImportManifest = z.infer<typeof SeedImportManifestSchema>;

export const DiscordApiAuthorSchema = z.looseObject({
  id: DiscordSnowflakeSchema,
  username: z.string(),
  global_name: z.string().nullable().optional(),
  discriminator: z.string(),
  bot: z.boolean().optional(),
  avatar: z.string().nullable().optional(),
});

export const DiscordApiAttachmentSchema = z.looseObject({
  id: DiscordSnowflakeSchema,
  filename: z.string(),
  size: z.number().int().nonnegative(),
  url: z.url(),
  proxy_url: z.url(),
  content_type: z.string().nullable().optional(),
  height: z.number().int().nonnegative().nullable().optional(),
  width: z.number().int().nonnegative().nullable().optional(),
  description: z.string().nullable().optional(),
  ephemeral: z.boolean().optional(),
});

export const DiscordApiMessageSchema = z.looseObject({
  id: DiscordSnowflakeSchema,
  channel_id: DiscordSnowflakeSchema,
  guild_id: DiscordSnowflakeSchema.optional(),
  author: DiscordApiAuthorSchema,
  content: z.string(),
  timestamp: IsoTimestampSchema,
  edited_timestamp: IsoTimestampSchema.nullable(),
  type: z.number().int().nonnegative(),
  flags: z.number().int().nonnegative().optional(),
  pinned: z.boolean(),
  tts: z.boolean(),
  attachments: z.array(DiscordApiAttachmentSchema),
  message_reference: z
    .looseObject({ message_id: DiscordSnowflakeSchema.optional() })
    .optional(),
});
export type DiscordApiMessage = z.infer<typeof DiscordApiMessageSchema>;

export const DiscordApiChannelSchema = z.looseObject({
  id: DiscordSnowflakeSchema,
  guild_id: DiscordSnowflakeSchema.optional(),
  parent_id: DiscordSnowflakeSchema.nullable().optional(),
  name: z.string().optional(),
  type: DiscordChannelTypeSchema,
  permission_overwrites: z
    .array(
      z.looseObject({
        id: DiscordSnowflakeSchema,
        type: z.union([z.literal(0), z.literal(1)]),
        allow: z.string().regex(/^\d+$/),
        deny: z.string().regex(/^\d+$/),
      }),
    )
    .optional(),
  thread_metadata: z
    .looseObject({
      archived: z.boolean(),
      locked: z.boolean().optional(),
      archive_timestamp: IsoTimestampSchema.optional(),
    })
    .optional(),
});
export type DiscordApiChannel = z.infer<typeof DiscordApiChannelSchema>;
