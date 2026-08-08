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

const StyleCardContentShape = {
  author: z.string().min(1),
  voice: StringListSchema,
  style_markers: StringListSchema,
  topics: StringListSchema,
  relationships: StringListSchema,
  behaviors: StringListSchema,
  personality: StringListSchema,
  humor_or_tone: StringListSchema,
  summary: z.union([z.string(), StringListSchema]),
  likes_dislikes: StringListSchema,
  league: z.record(z.string(), LeagueValueSchema),
  other_games: StringListSchema,
  how_to_mimic: StringListSchema,
} as const;

export const LegacyStyleCardSchema = z.strictObject({
  ...StyleCardContentShape,
  coverage: z.strictObject({
    messages: z.number().int().nonnegative(),
    date_range: z.string(),
    truncated: z.boolean().optional(),
    "truncated?": z.boolean().optional(),
    notes: z.string(),
  }),
  quotes: StringListSchema,
  sample_messages: StringListSchema,
  concerns: StringListSchema.optional(),
});
export type LegacyStyleCard = z.infer<typeof LegacyStyleCardSchema>;

const StyleDateRangeSchema = z.strictObject({
  start: IsoInstantSchema,
  end: IsoInstantSchema,
});

export const StyleCardCoverageV2Schema = z.strictObject({
  source_snapshot_sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  corpus: z.strictObject({
    messages: z.number().int().nonnegative(),
    date_range: StyleDateRangeSchema,
  }),
  evidence: z.strictObject({
    safe_messages: z.number().int().nonnegative(),
    summarized_messages: z.number().int().nonnegative(),
    chunks: z.number().int().nonnegative(),
    direct_recent_messages: z.number().int().nonnegative(),
    date_range: StyleDateRangeSchema,
    strategy: z.literal("all-safe-monthly-chunks-plus-latest-500"),
  }),
  notes: z.string(),
});
export type StyleCardCoverageV2 = z.infer<typeof StyleCardCoverageV2Schema>;

export const SituationalExamplesSchema = z.strictObject({
  provenance: z.literal("synthetic"),
  happy_or_excited: z.array(z.string()).length(3),
  angry_or_frustrated: z.array(z.string()).length(3),
  sad_or_disappointed: z.array(z.string()).length(3),
  supportive_or_caring: z.array(z.string()).length(3),
  playful_or_teasing: z.array(z.string()).length(3),
  neutral_or_logistical: z.array(z.string()).length(3),
});
export type SituationalExamples = z.infer<typeof SituationalExamplesSchema>;

export const StylePromptContextSchema = z.strictObject({
  ...StyleCardContentShape,
  quotes: z.array(z.string()).length(20),
  sample_messages: z.array(z.string()).length(30),
  situational_examples: SituationalExamplesSchema,
  concerns: StringListSchema,
});
export type StylePromptContext = z.infer<typeof StylePromptContextSchema>;

export const StyleCardV2Schema = z.strictObject({
  schemaVersion: z.literal(2),
  coverage: StyleCardCoverageV2Schema,
  ...StylePromptContextSchema.shape,
});
export type StyleCardV2 = z.infer<typeof StyleCardV2Schema>;

export const StyleCardSchema = z.union([
  LegacyStyleCardSchema,
  StyleCardV2Schema,
]);
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

export const FriendContextSourceSchema = z.strictObject({
  peopleDocument: PeopleDocumentSchema,
  relationshipsDocument: RelationshipsDocumentSchema,
  loreDocument: LoreDocumentSchema,
});
export type FriendContextSource = z.infer<typeof FriendContextSourceSchema>;

export const FriendContextInputSchema = z.strictObject({
  message: z.string(),
  references: z.array(z.string().min(1)).default([]),
  mentionedDiscordUserIds: z.array(DiscordIdSchema).default([]),
  resolveMessageAliases: z.boolean().default(true),
  characterBudget: z.number().int().nonnegative().max(48_000),
  maxLoreSections: z.number().int().positive().max(12).default(6),
});
export type FriendContextInput = z.infer<typeof FriendContextInputSchema>;

export const PersonReferenceMatchKindSchema = z.enum([
  "alias",
  "discord-user-id",
  "prefix",
]);
export type PersonReferenceMatchKind = z.infer<
  typeof PersonReferenceMatchKindSchema
>;

const MatchedPersonReferenceSchema = z.strictObject({
  status: z.literal("matched"),
  reference: z.string(),
  matchKind: PersonReferenceMatchKindSchema,
  person: PersonSchema,
});
const AmbiguousPersonReferenceSchema = z.strictObject({
  status: z.literal("ambiguous"),
  reference: z.string(),
  candidates: z.array(PersonSchema).min(2),
});
const UnmatchedPersonReferenceSchema = z.strictObject({
  status: z.literal("unmatched"),
  reference: z.string(),
});
export const PersonReferenceResolutionSchema = z.discriminatedUnion("status", [
  MatchedPersonReferenceSchema,
  AmbiguousPersonReferenceSchema,
  UnmatchedPersonReferenceSchema,
]);
export type PersonReferenceResolution = z.infer<
  typeof PersonReferenceResolutionSchema
>;

export const ResolvedFriendContextPersonSchema = z.strictObject({
  person: PersonSchema,
  matchedReferences: z.array(z.string().min(1)).min(1),
});
export type ResolvedFriendContextPerson = z.infer<
  typeof ResolvedFriendContextPersonSchema
>;

export const FriendContextLoreSectionSchema = z.strictObject({
  id: IdentifierSchema,
  title: z.string().min(1),
  markdown: z.string().min(1),
  score: z.number().int().positive(),
  matchedTerms: z.array(z.string().min(1)),
});
export type FriendContextLoreSection = z.infer<
  typeof FriendContextLoreSectionSchema
>;

export const FriendContextResultSchema = z.strictObject({
  resolutions: z.array(PersonReferenceResolutionSchema),
  people: z.array(ResolvedFriendContextPersonSchema),
  relationships: z.array(RelationshipEventSchema),
  loreSections: z.array(FriendContextLoreSectionSchema),
  contextText: z.string(),
  characterCount: z.number().int().nonnegative(),
  truncated: z.boolean(),
});
export type FriendContextResult = z.infer<typeof FriendContextResultSchema>;
