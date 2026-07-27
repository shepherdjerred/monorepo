import { z } from "zod";

const IdentifierSchema = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u, "expected a kebab-case identifier");
const DiscordIdSchema = z.string().regex(/^\d{17,20}$/u);
const IsoInstantSchema = z.iso.datetime({ offset: true });

export const PersonKindSchema = z.enum(["person", "group"]);
export type PersonKind = z.infer<typeof PersonKindSchema>;

export const PersonSchema = z.strictObject({
  id: IdentifierSchema,
  displayName: z.string().min(1),
  kind: PersonKindSchema,
  aliases: z.array(z.string().min(1)),
  discordUserIds: z.array(DiscordIdSchema),
});
export type Person = z.infer<typeof PersonSchema>;

export const PeopleDocumentSchema = z
  .strictObject({
    $schema: z.string().optional(),
    schemaVersion: z.literal(1),
    people: z.array(PersonSchema),
  })
  .superRefine((document, context) => {
    const ids = new Set<string>();
    const aliases = new Set<string>();
    const discordUserIds = new Set<string>();
    for (const person of document.people) {
      if (ids.has(person.id)) {
        context.addIssue({
          code: "custom",
          message: `duplicate person id: ${person.id}`,
        });
      }
      ids.add(person.id);
      const personAliases = new Set(
        [person.id, person.displayName, ...person.aliases].map((alias) =>
          alias.toLocaleLowerCase(),
        ),
      );
      for (const normalized of personAliases) {
        if (aliases.has(normalized)) {
          context.addIssue({
            code: "custom",
            message: `duplicate person alias: ${normalized}`,
          });
        }
        aliases.add(normalized);
      }
      for (const discordUserId of person.discordUserIds) {
        if (discordUserIds.has(discordUserId)) {
          context.addIssue({
            code: "custom",
            message: `duplicate Discord user id: ${discordUserId}`,
          });
        }
        discordUserIds.add(discordUserId);
      }
    }
  });
export type PeopleDocument = z.infer<typeof PeopleDocumentSchema>;

export const RelationshipDirectionSchema = z.enum([
  "undirected",
  "source-to-target",
]);
export const RelationshipStatusSchema = z.enum(["current", "historical"]);
export const RelationshipKindSchema = z.enum([
  "membership",
  "friendship",
  "family",
  "romantic",
  "professional",
  "social",
  "adversarial",
  "other",
]);
export const RelationshipProvenanceSchema = z.strictObject({
  kind: z.enum(["legacy-graph", "maintainer-assertion", "corpus-evidence"]),
  reference: z.string().min(1),
  messageIds: z.array(DiscordIdSchema),
});
export const RelationshipEventSchema = z.strictObject({
  id: IdentifierSchema,
  sourceId: IdentifierSchema,
  targetId: IdentifierSchema,
  kind: RelationshipKindSchema,
  label: z.string(),
  direction: RelationshipDirectionSchema,
  status: RelationshipStatusSchema,
  effectiveAt: z.iso.date().nullable(),
  recordedAt: IsoInstantSchema,
  supersedesEventId: IdentifierSchema.nullable(),
  provenance: z.array(RelationshipProvenanceSchema).min(1),
});
export type RelationshipEvent = z.infer<typeof RelationshipEventSchema>;

export const RelationshipsDocumentSchema = z
  .strictObject({
    $schema: z.string().optional(),
    schemaVersion: z.literal(1),
    events: z.array(RelationshipEventSchema),
  })
  .superRefine((document, context) => {
    const ids = new Set<string>();
    for (const event of document.events) {
      if (ids.has(event.id)) {
        context.addIssue({
          code: "custom",
          message: `duplicate relationship event id: ${event.id}`,
        });
      }
      ids.add(event.id);
    }
    for (const event of document.events) {
      if (
        event.supersedesEventId !== null &&
        !ids.has(event.supersedesEventId)
      ) {
        context.addIssue({
          code: "custom",
          message: `unknown superseded event: ${event.supersedesEventId}`,
        });
      }
    }
  });
export type RelationshipsDocument = z.infer<typeof RelationshipsDocumentSchema>;

const StringListSchema = z.array(z.string());
const LeagueValueSchema = z.union([
  z.string(),
  StringListSchema,
  z.strictObject({
    likes: StringListSchema,
    dislikes: StringListSchema,
  }),
]);
export const StyleCardSchema = z.strictObject({
  author: z.string().min(1),
  coverage: z.strictObject({
    messages: z.number().int().nonnegative(),
    date_range: z.string(),
    truncated: z.boolean().optional(),
    "truncated?": z.boolean().optional(),
    notes: z.string(),
  }),
  voice: StringListSchema,
  style_markers: StringListSchema,
  topics: StringListSchema,
  relationships: StringListSchema,
  behaviors: StringListSchema,
  personality: StringListSchema,
  humor_or_tone: StringListSchema,
  quotes: StringListSchema,
  summary: z.union([z.string(), StringListSchema]),
  likes_dislikes: StringListSchema,
  league: z.record(z.string(), LeagueValueSchema),
  other_games: StringListSchema,
  how_to_mimic: StringListSchema,
  sample_messages: StringListSchema,
  concerns: StringListSchema.optional(),
});
export type StyleCard = z.infer<typeof StyleCardSchema>;

export const StyleCardsDocumentSchema = z.record(
  IdentifierSchema,
  StyleCardSchema,
);
export type StyleCardsDocument = z.infer<typeof StyleCardsDocumentSchema>;

export const GenerationStateEntrySchema = z.strictObject({
  personId: IdentifierSchema,
  lastMessageId: DiscordIdSchema.nullable(),
  sourceSnapshotChecksum: z
    .string()
    .regex(/^[a-f0-9]{64}$/u)
    .nullable(),
  messageCount: z.number().int().nonnegative(),
  refreshedAt: IsoInstantSchema.nullable(),
});
export type GenerationStateEntry = z.infer<typeof GenerationStateEntrySchema>;
export const GenerationStateDocumentSchema = z.strictObject({
  $schema: z.string().optional(),
  schemaVersion: z.literal(1),
  relationshipSourceSnapshotChecksum: z
    .string()
    .regex(/^[a-f0-9]{64}$/u)
    .nullable(),
  relationshipRefreshedAt: IsoInstantSchema.nullable(),
  people: z.array(GenerationStateEntrySchema),
});
export type GenerationStateDocument = z.infer<
  typeof GenerationStateDocumentSchema
>;

export const LoreDocumentSchema = z.strictObject({
  $schema: z.string().optional(),
  schemaVersion: z.literal(1),
  historyMarkdown: z.string().min(1),
});
export type LoreDocument = z.infer<typeof LoreDocumentSchema>;
