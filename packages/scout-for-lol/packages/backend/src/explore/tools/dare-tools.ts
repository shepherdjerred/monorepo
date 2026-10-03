import { buildDareShortlist } from "#src/betting/dares/dare-shortlist.ts";
import {
  createDareDraft,
  deleteDareDraft,
  prepareDareDraft,
  reviseDareDraft,
} from "#src/betting/dares/lifecycle/dare-draft.ts";
import { dareLanguagePayload } from "#src/explore/tools/dare-language.ts";
import { compileDareSql } from "#src/betting/dares/sql/dare-sql.ts";
import { renderDareSqlSemanticProofPlan } from "#src/betting/dares/sql/dare-sql-description.ts";
import { createDareConfirmationIntent } from "#src/betting/dares/lifecycle/dare-intent.ts";
import {
  inspectVisibleDare,
  listVisibleDares,
} from "#src/betting/dares/presentation/dare-view.ts";
import { prisma } from "#src/database/index.ts";
import {
  DareActionToolInputSchema,
  DareDefinitionToolInputSchema,
  DareDeleteToolInputSchema,
  DareInspectToolInputSchema,
  DareListToolInputSchema,
  DarePreviewToolInputSchema,
  DareScoutQlToolInputSchema,
  ReviseDareToolInputSchema,
} from "#src/explore/tools/dare-tool-schemas.ts";
import { definitionFromTool } from "#src/explore/tools/dare-tool-definition-resolution.ts";
import {
  dareDraftChannel,
  type DareExploreToolsInput,
} from "#src/explore/tools/dare-tool-context.ts";
import {
  dareDomainResult,
  dareToolResult,
} from "#src/explore/tools/dare-tool-result.ts";

const result = dareToolResult;
const safeDomainResult = dareDomainResult;
function createDareReadExecutors(input: DareExploreToolsInput) {
  return {
    list: (raw: unknown) =>
      input.track("list_dares", async () => {
        const parsed = DareListToolInputSchema.parse(raw);
        const dares = await listVisibleDares(
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
        const dare = await inspectVisibleDare(
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
  };
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
  const definition = async (raw: unknown) =>
    definitionFromTool(
      DareDefinitionToolInputSchema.parse(raw),
      await shortlist(),
    );
  const resolvedTargets = async (requestedKeys: readonly string[]) => {
    const available = await shortlist();
    return [...new Set(requestedKeys)].map((key) => {
      const target = available.find((candidate) => candidate.key === key);
      if (target === undefined) {
        throw new Error(`Dare target ${key} is not in the current shortlist.`);
      }
      return target;
    });
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
          dareLanguagePayload({ targets }),
        );
      }),
    validateScoutQl: (raw: unknown) =>
      input.track("validate_dare_scoutql", async () => {
        const parsed = DareScoutQlToolInputSchema.parse(raw);
        const targets = await resolvedTargets(parsed.targetKeys);
        try {
          const compilation = await compileDareSql({
            queryText: parsed.queryText,
            targetKeys: targets.map((target) => target.key),
          });
          return result(
            "valid_sql",
            "The standard SQL Dare contract is valid and canonically formatted.",
            {
              canonicalSql: compilation.canonicalSql,
              queryHash: compilation.queryHash,
              facts: compilation.facts,
              finality: compilation.finality,
            },
          );
        } catch (error) {
          return result("invalid_sql", "The Dare SQL is not valid.", {
            issues: [error instanceof Error ? error.message : String(error)],
          });
        }
      }),
    validate: (raw: unknown) =>
      input.track("validate_dare_contract", async () => {
        const prepared = await prepareDareDraft(await definition(raw));
        return prepared.kind === "valid"
          ? result("valid", "The standard SQL dare contract is valid.", {
              canonicalSql: prepared.draft.compilation.canonicalSql,
              queryHash: prepared.draft.compilation.queryHash,
              facts: prepared.draft.compilation.facts,
              finality: prepared.draft.compilation.finality,
              plainLanguage: prepared.draft.plainLanguage,
              semanticProofPlan: renderDareSqlSemanticProofPlan(
                prepared.draft.compilation,
              ),
              preview: prepared.draft.preview,
            })
          : result("invalid", "The dare contract needs revision.", {
              issues: prepared.issues,
            });
      }),
    preview: (raw: unknown) =>
      input.track("preview_dare_contract", async () => {
        const parsed = DarePreviewToolInputSchema.parse(raw);
        const prepared = await prepareDareDraft({
          ...definitionFromTool(parsed, await shortlist()),
          historyDays: parsed.historyDays,
        });
        if (prepared.kind === "invalid") {
          return result("invalid", "The dare contract needs revision.", {
            issues: prepared.issues,
          });
        }
        return result("previewed", "Historically executed the canonical SQL.", {
          ...prepared.draft.preview,
          start: new Date(
            Date.now() - parsed.historyDays * 24 * 60 * 60 * 1000,
          ).toISOString(),
          end: new Date().toISOString(),
          canonicalSql: prepared.draft.compilation.canonicalSql,
          plainLanguage: prepared.draft.plainLanguage,
        });
      }),
    create: (raw: unknown) =>
      input.track("create_dare_draft", async () => {
        const created = await createDareDraft({
          ...(await definition(raw)),
          serverId: input.capability.serverId,
          channelId: dareDraftChannel(input),
          challengerDiscordId: input.requesterId,
          originConversationId: input.conversationId,
        });
        if (created.kind !== "created") {
          return safeDomainResult(created, "The dare draft was not created.");
        }
        return result("created", "The private SQL dare draft was saved.", {
          dareId: created.dareId,
          revision: created.revision,
          canonicalScoutQl: created.draft.compilation.canonicalSql,
          queryHash: created.draft.compilation.queryHash,
          originalText: created.draft.originalText,
          plainLanguage: created.draft.plainLanguage,
          semanticProofPlan: renderDareSqlSemanticProofPlan(
            created.draft.compilation,
          ),
          preview: created.draft.preview,
          sqlIsBinding: true,
          openingStake: created.draft.openingStake,
          targetAliases: created.draft.targets.map((target) => target.alias),
        });
      }),
    revise: (raw: unknown) =>
      input.track("revise_dare_draft", async () => {
        const parsed = ReviseDareToolInputSchema.parse(raw);
        const revised = await reviseDareDraft({
          dareId: parsed.dareId,
          serverId: input.capability.serverId,
          challengerDiscordId: input.requesterId,
          expectedRevision: parsed.expectedRevision,
          definition: definitionFromTool(parsed, await shortlist()),
        });
        if (revised.kind !== "revised") {
          return safeDomainResult(revised, "The dare draft was not revised.");
        }
        return result("revised", "A new private SQL revision was saved.", {
          dareId: revised.dareId,
          revision: revised.revision,
          canonicalScoutQl: revised.draft.compilation.canonicalSql,
          queryHash: revised.draft.compilation.queryHash,
          originalText: revised.draft.originalText,
          plainLanguage: revised.draft.plainLanguage,
          semanticProofPlan: renderDareSqlSemanticProofPlan(
            revised.draft.compilation,
          ),
          preview: revised.draft.preview,
          sqlIsBinding: true,
        });
      }),
    ...createDareReadExecutors(input),
    prepareAction: (raw: unknown) =>
      input.track("prepare_dare_action", async () => {
        const parsed = DareActionToolInputSchema.parse(raw);
        const intent = await createDareConfirmationIntent({
          dareId: parsed.dareId,
          serverId: input.capability.serverId,
          actorDiscordId: input.requesterId,
          expectedRevision: parsed.expectedRevision,
          payload: parsed.payload,
          idempotencyKey: globalThis.crypto.randomUUID(),
        });
        const dare =
          intent.kind === "intent_created"
            ? await inspectVisibleDare(
                {
                  dareId: parsed.dareId,
                  serverId: input.capability.serverId,
                  viewerDiscordId: input.requesterId,
                },
                prisma,
              )
            : null;
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
                ...(dare === null
                  ? {}
                  : {
                      originalText: dare.originalText,
                      plainLanguage: dare.plainLanguage,
                      canonicalScoutQl: dare.canonicalScoutQl,
                      semanticProofPlan: dare.semanticProofPlan,
                      sqlIsBinding: true,
                    }),
              },
            )
          : safeDomainResult(intent, "The action could not be prepared.");
      }),
    deleteDraft: (raw: unknown) =>
      input.track("delete_dare_draft", async () => {
        const parsed = DareDeleteToolInputSchema.parse(raw);
        const deleted = await deleteDareDraft({
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
