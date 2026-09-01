import { tool } from "ai";
import { z } from "zod";
import {
  BucksStakeSchema,
  DARE_V2_MAX_ELIGIBLE_GAMES,
  DARE_V2_MAX_EXPRESSION_DEPTH,
  DARE_V2_MAX_GAME_SETS,
  DARE_V2_MAX_HORIZON_DAYS,
  DARE_V2_MAX_JOINED_RELATIONS,
  DARE_V2_MAX_PREDICATES,
  DARE_V2_MAX_QUERY_LENGTH,
  DARE_V2_MAX_TARGETS,
  DareCompiledPlanV2Schema,
  DareDeadlineSpecV2Schema,
  DiscordChannelIdSchema,
  type DiscordAccountId,
  type DiscordChannelId,
} from "@scout-for-lol/data";
import type { BucksExploreCapability } from "#src/explore/bucks-tools.ts";
import { buildDareShortlist } from "#src/betting/dare-shortlist.ts";
import {
  createDareDraftV2,
  deleteDareDraftV2,
  prepareDareDraftV2,
  reviseDareDraftV2,
  type DareDraftV2Definition,
} from "#src/betting/dare-draft-v2.ts";
import {
  createDareV2ConfirmationIntent,
  DareV2IntentPayloadSchema,
} from "#src/betting/dare-intent-v2.ts";
import {
  inspectVisibleDareV2,
  listVisibleDaresV2,
} from "#src/betting/dare-view-v2.ts";
import { isPolicyEnabled } from "#src/configuration/flags.ts";
import { historicallyPreviewDareV2 } from "#src/betting/dare-preview-v2.ts";
import { prisma } from "#src/database/index.ts";
import { COMMON_DENOMINATOR_CHANNEL_ID } from "#src/discord/channels.ts";
import type { ToolTracker } from "#src/reports/ai/scoutql-tools.ts";

export const DareToolResultSchema = z.strictObject({
  kind: z.string().min(1),
  message: z.string().min(1),
  data: z.json().nullable(),
});
export type DareToolResult = z.infer<typeof DareToolResultSchema>;

export const DareDefinitionToolInputSchema = z.strictObject({
  originalText: z.string().min(1).max(4000),
  targetKeys: z
    .array(z.string().regex(/^T\d{1,2}$/))
    .min(1)
    .max(5),
  plan: DareCompiledPlanV2Schema,
  deadlineSpec: DareDeadlineSpecV2Schema,
  openingStake: BucksStakeSchema,
});

export const ReviseDareToolInputSchema = DareDefinitionToolInputSchema.extend({
  dareId: z.number().int().positive(),
  expectedRevision: z.number().int().positive(),
});

export const DarePreviewToolInputSchema = DareDefinitionToolInputSchema.extend({
  historyDays: z
    .number()
    .int()
    .min(1)
    .max(DARE_V2_MAX_HORIZON_DAYS)
    .default(30),
});

export const DareListToolInputSchema = z.strictObject({
  scope: z.enum(["mine", "guild"]),
  search: z.string().min(1).max(100).optional(),
});

export const DareInspectToolInputSchema = z.strictObject({
  dareId: z.number().int().positive(),
});

export const DareActionToolInputSchema = z.strictObject({
  dareId: z.number().int().positive(),
  expectedRevision: z.number().int().positive(),
  payload: DareV2IntentPayloadSchema,
});

export const DareDeleteToolInputSchema = z.strictObject({
  dareId: z.number().int().positive(),
  expectedRevision: z.number().int().positive(),
});

export type DareExploreToolsInput = {
  capability: BucksExploreCapability;
  requesterId: DiscordAccountId;
  conversationId: string;
  originChannelId: DiscordChannelId | null;
  track: ToolTracker;
};

export async function dareExploreEnabled(
  capability: BucksExploreCapability | null,
): Promise<boolean> {
  return (
    capability !== null &&
    (await isPolicyEnabled("dare_v2", {
      server: capability.serverId,
    }))
  );
}

function result(kind: string, message: string, data: unknown): DareToolResult {
  return DareToolResultSchema.parse({
    kind,
    message,
    data: data === undefined ? null : data,
  });
}

function safeDomainResult(value: { kind: string }, message: string) {
  return result(value.kind, message, value);
}

function definitionFromTool(
  input: z.infer<typeof DareDefinitionToolInputSchema>,
  targets: Awaited<ReturnType<typeof buildDareShortlist>>,
): DareDraftV2Definition {
  const requested = new Set(input.targetKeys);
  if (requested.size !== input.targetKeys.length) {
    throw new Error("A dare target key may appear only once.");
  }
  const resolved = input.targetKeys.map((key) => {
    const target = targets.find((candidate) => candidate.key === key);
    if (target === undefined) {
      throw new Error(`Dare target ${key} is not in the current shortlist.`);
    }
    return target;
  });
  return {
    originalText: input.originalText,
    targets: resolved,
    plan: input.plan,
    deadlineSpec: input.deadlineSpec,
    openingStake: input.openingStake,
  };
}

function draftChannel(input: DareExploreToolsInput): DiscordChannelId {
  return DiscordChannelIdSchema.parse(
    input.originChannelId ?? COMMON_DENOMINATOR_CHANNEL_ID,
  );
}

export function createDareToolExecutors(input: DareExploreToolsInput) {
  let shortlistPromise: ReturnType<typeof buildDareShortlist> | undefined;
  const shortlist = () => {
    shortlistPromise ??= buildDareShortlist(
      input.capability.serverId,
      input.requesterId,
      prisma,
    );
    return shortlistPromise;
  };

  const definition = async (raw: unknown) => {
    const parsed = DareDefinitionToolInputSchema.parse(raw);
    return {
      parsed,
      definition: definitionFromTool(parsed, await shortlist()),
    };
  };

  return {
    language: () =>
      input.track("get_dare_language", async () => {
        const targets = await shortlist();
        return result(
          "language",
          targets.length === 0
            ? "No eligible targets are currently linked in this guild."
            : "Use only these target keys and the closed contract schema.",
          {
            targets: targets.map((target) => ({
              key: target.key,
              alias: target.alias,
            })),
            limits: {
              targets: DARE_V2_MAX_TARGETS,
              gameSets: DARE_V2_MAX_GAME_SETS,
              joinedRelations: DARE_V2_MAX_JOINED_RELATIONS,
              predicates: DARE_V2_MAX_PREDICATES,
              expressionDepth: DARE_V2_MAX_EXPRESSION_DEPTH,
              queryCharacters: DARE_V2_MAX_QUERY_LENGTH,
              eligibleGames: DARE_V2_MAX_ELIGIBLE_GAMES,
              horizonDays: DARE_V2_MAX_HORIZON_DAYS,
            },
            defaults: {
              queues: ["solo", "flex"],
              relativeDeadlineDays: 7,
              orderBy: "game_end_at_asc_match_id_asc",
            },
          },
        );
      }),
    validate: (raw: unknown) =>
      input.track("validate_dare_contract", async () => {
        const resolved = await definition(raw);
        const prepared = prepareDareDraftV2(resolved.definition);
        return prepared.kind === "valid"
          ? result("valid", "The dare contract is valid.", {
              canonicalScoutQl: prepared.draft.canonicalScoutQl,
              plainLanguage: prepared.draft.plainLanguage,
              semanticProofPlan: prepared.draft.semanticProofPlan,
            })
          : result("invalid", "The dare contract needs revision.", {
              issues: prepared.issues,
            });
      }),
    preview: (raw: unknown) =>
      input.track("preview_dare_contract", async () => {
        const parsed = DarePreviewToolInputSchema.parse(raw);
        const prepared = prepareDareDraftV2(
          definitionFromTool(parsed, await shortlist()),
        );
        if (prepared.kind !== "valid") {
          return result("invalid", "The dare contract needs revision.", {
            issues: prepared.issues,
          });
        }
        const end = new Date();
        const start = new Date(
          end.getTime() - parsed.historyDays * 24 * 60 * 60 * 1000,
        );
        const preview = await historicallyPreviewDareV2({
          plan: prepared.draft.plan,
          targets: prepared.draft.targets,
          start,
          end,
        });
        return result(
          "previewed",
          preview.eligibleGames === 0
            ? "No retained eligible games were found in the preview window."
            : `Historically evaluated ${preview.eligibleGames.toString()} eligible games.`,
          {
            ...preview,
            start: start.toISOString(),
            end: end.toISOString(),
            canonicalScoutQl: prepared.draft.canonicalScoutQl,
            plainLanguage: prepared.draft.plainLanguage,
          },
        );
      }),
    create: (raw: unknown) =>
      input.track("create_dare_draft", async () => {
        const resolved = await definition(raw);
        const created = await createDareDraftV2({
          ...resolved.definition,
          serverId: input.capability.serverId,
          channelId: draftChannel(input),
          challengerDiscordId: input.requesterId,
          originConversationId: input.conversationId,
        });
        if (created.kind !== "created") {
          return safeDomainResult(created, "The dare draft was not created.");
        }
        return result("created", "The private dare draft was saved.", {
          dareId: created.dareId,
          revision: created.revision,
          canonicalScoutQl: created.draft.canonicalScoutQl,
          plainLanguage: created.draft.plainLanguage,
          semanticProofPlan: created.draft.semanticProofPlan,
          openingStake: created.draft.openingStake,
          targetAliases: created.draft.targets.map((target) => target.alias),
        });
      }),
    revise: (raw: unknown) =>
      input.track("revise_dare_draft", async () => {
        const parsed = ReviseDareToolInputSchema.parse(raw);
        const resolved = await definition(parsed);
        const revised = await reviseDareDraftV2({
          dareId: parsed.dareId,
          serverId: input.capability.serverId,
          challengerDiscordId: input.requesterId,
          expectedRevision: parsed.expectedRevision,
          definition: resolved.definition,
        });
        if (revised.kind !== "revised") {
          return safeDomainResult(revised, "The dare draft was not revised.");
        }
        return result("revised", "A new private draft revision was saved.", {
          dareId: revised.dareId,
          revision: revised.revision,
          canonicalScoutQl: revised.draft.canonicalScoutQl,
          plainLanguage: revised.draft.plainLanguage,
          semanticProofPlan: revised.draft.semanticProofPlan,
          openingStake: revised.draft.openingStake,
          targetAliases: revised.draft.targets.map((target) => target.alias),
        });
      }),
    list: (raw: unknown) =>
      input.track("list_dares", async () => {
        const parsed = DareListToolInputSchema.parse(raw);
        const dares = await listVisibleDaresV2(
          {
            serverId: input.capability.serverId,
            viewerDiscordId: input.requesterId,
            scope: parsed.scope,
            ...(parsed.search === undefined ? {} : { search: parsed.search }),
          },
          prisma,
        );
        return result(
          "listed",
          `Found ${dares.length.toString()} visible dares.`,
          { dares },
        );
      }),
    inspect: (raw: unknown) =>
      input.track("inspect_dare", async () => {
        const parsed = DareInspectToolInputSchema.parse(raw);
        const dare = await inspectVisibleDareV2(
          {
            dareId: parsed.dareId,
            serverId: input.capability.serverId,
            viewerDiscordId: input.requesterId,
          },
          prisma,
        );
        return dare === null
          ? result("not_found", "That dare is not visible to this user.", null)
          : result("inspected", "Loaded the frozen dare contract.", { dare });
      }),
    prepareAction: (raw: unknown) =>
      input.track("prepare_dare_action", async () => {
        const parsed = DareActionToolInputSchema.parse(raw);
        const intent = await createDareV2ConfirmationIntent({
          dareId: parsed.dareId,
          serverId: input.capability.serverId,
          actorDiscordId: input.requesterId,
          expectedRevision: parsed.expectedRevision,
          payload: parsed.payload,
          idempotencyKey: globalThis.crypto.randomUUID(),
        });
        return intent.kind === "intent_created"
          ? result(
              "confirmation_required",
              "The action is ready for explicit confirmation and expires in ten minutes.",
              {
                intentId: intent.intentId,
                action: intent.action,
                expiresAt: intent.expiresAt.toISOString(),
                dareId: parsed.dareId,
                revision: parsed.expectedRevision,
              },
            )
          : safeDomainResult(intent, "The action could not be prepared.");
      }),
    deleteDraft: (raw: unknown) =>
      input.track("delete_dare_draft", async () => {
        const parsed = DareDeleteToolInputSchema.parse(raw);
        const deleted = await deleteDareDraftV2({
          dareId: parsed.dareId,
          serverId: input.capability.serverId,
          challengerDiscordId: input.requesterId,
          expectedRevision: parsed.expectedRevision,
        });
        return safeDomainResult(
          deleted,
          deleted.kind === "deleted"
            ? "The private draft was deleted."
            : "That draft cannot be deleted.",
        );
      }),
  };
}

export function createDareExploreTools(input: DareExploreToolsInput) {
  const executors = createDareToolExecutors(input);
  return {
    get_dare_language: tool({
      description:
        "Load Dare v2 target keys, defaults, and hard limits before validating, creating, or revising a dare. Call this first for any dare-authoring request.",
      inputSchema: z.strictObject({}),
      outputSchema: DareToolResultSchema,
      execute: () => executors.language(),
    }),
    validate_dare_contract: tool({
      description:
        "Validate and canonically format a proposed Dare v2 plan without saving it. Returns generated ScoutQL, exact plain-language meaning, and the semantic proof plan. Call before create or revise.",
      inputSchema: DareDefinitionToolInputSchema,
      outputSchema: DareToolResultSchema,
      execute: (raw) => executors.validate(raw),
    }),
    preview_dare_contract: tool({
      description:
        "Historically preview a valid Dare v2 plan against retained lake data. Returns true, false, or null, explicit timeline coverage, eligible-game count, and per-game-set evidence. A preview never creates or funds anything.",
      inputSchema: DarePreviewToolInputSchema,
      outputSchema: DareToolResultSchema,
      execute: (raw) => executors.preview(raw),
    }),
    create_dare_draft: tool({
      description:
        "Save a new private, unfunded Dare v2 draft after validation. A same-game conjunction belongs in ONE game set with an AND predicate; separate game sets are allowed to match different games.",
      inputSchema: DareDefinitionToolInputSchema,
      outputSchema: DareToolResultSchema,
      execute: (raw) => executors.create(raw),
    }),
    revise_dare_draft: tool({
      description:
        "Append a revision to a private, unfunded Dare v2 draft. Requires the exact current revision and never mutates a funded contract.",
      inputSchema: ReviseDareToolInputSchema,
      outputSchema: DareToolResultSchema,
      execute: (raw) => executors.revise(raw),
    }),
    list_dares: tool({
      description:
        "List the requester's dares (authored, targeted, or funded) or every funded guild-visible dare, with status and progress.",
      inputSchema: DareListToolInputSchema,
      outputSchema: DareToolResultSchema,
      execute: (raw) => executors.list(raw),
    }),
    inspect_dare: tool({
      description:
        "Inspect one visible dare, including its frozen ScoutQL, exact meaning, targets, acceptance, progress, result, and proof.",
      inputSchema: DareInspectToolInputSchema,
      outputSchema: DareToolResultSchema,
      execute: (raw) => executors.inspect(raw),
    }),
    prepare_dare_action: tool({
      description:
        "Prepare a revision-bound confirmation intent for fund, accept, decline, contribute, or cancel. This does not perform the action; the user must confirm the returned single-use intent within ten minutes.",
      inputSchema: DareActionToolInputSchema,
      outputSchema: DareToolResultSchema,
      execute: (raw) => executors.prepareAction(raw),
    }),
    delete_dare_draft: tool({
      description:
        "Delete the requester's own private unfunded draft. Funded or terminal dares cannot be deleted.",
      inputSchema: DareDeleteToolInputSchema,
      outputSchema: DareToolResultSchema,
      execute: (raw) => executors.deleteDraft(raw),
    }),
  };
}
