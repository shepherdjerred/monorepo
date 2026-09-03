import {
  DARE_V2_MAX_ELIGIBLE_GAMES,
  DARE_V2_MAX_EXPRESSION_DEPTH,
  DARE_V2_MAX_GAME_SETS,
  DARE_V2_MAX_HORIZON_DAYS,
  DARE_V2_MAX_JOINED_RELATIONS,
  DARE_V2_MAX_PREDICATES,
  DARE_V2_MAX_QUERY_LENGTH,
  DARE_V2_MAX_TARGETS,
} from "@scout-for-lol/data";
import { buildDareShortlist } from "#src/betting/dare-shortlist.ts";
import {
  createDareDraftV3,
  prepareDareDraftV3,
  reviseDareDraftV3,
} from "#src/betting/dare-draft-v3.ts";
import { dareSqlV3Catalog } from "#src/betting/dare-sql-v3-catalog.ts";
import { compileDareSqlV3 } from "#src/betting/dare-sql-v3.ts";
import {
  createDareDraftV2,
  prepareDareDraftV2,
  reviseDareDraftV2,
} from "#src/betting/dare-draft-v2.ts";
import {
  inspectVisibleDareV2,
  listVisibleDaresV2,
} from "#src/betting/dare-view-v2.ts";
import { isPolicyEnabled } from "#src/configuration/flags.ts";
import { historicallyPreviewDareV2 } from "#src/betting/dare-preview-v2.ts";
import {
  renderDarePlanV2,
  renderDareProofPlanV2,
} from "#src/betting/dare-render-v2.ts";
import { compileDareScoutQlPlanV2 } from "#src/betting/dare-scoutql-plan-compiler-v2.ts";
import { prisma } from "#src/database/index.ts";
import {
  DareDefinitionToolInputSchema,
  DareDefinitionV2ToolInputSchema,
  DareDefinitionV3ToolInputSchema,
  DareInspectToolInputSchema,
  DareListToolInputSchema,
  DarePreviewToolInputSchema,
  DareScoutQlToolInputSchema,
  ReviseDareToolInputSchema,
} from "#src/explore/dare-tool-schemas.ts";
import {
  definitionFromTool,
  definitionV3FromTool,
} from "#src/explore/dare-tool-definition-resolution.ts";
import {
  dareDraftChannel,
  type DareExploreToolsInput,
} from "#src/explore/dare-tool-context.ts";
import {
  dareDomainResult,
  dareToolResult,
} from "#src/explore/dare-tool-result.ts";
import { createDareActionExecutors } from "#src/explore/dare-tool-action-executors.ts";

const result = dareToolResult;
const safeDomainResult = dareDomainResult;

function createDareReadExecutors(input: DareExploreToolsInput) {
  return {
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

  const sqlV3Enabled = async () =>
    await isPolicyEnabled("dare_sql_v3", {
      server: input.capability.serverId,
    });

  const definition = async (raw: unknown) => {
    const parsed = DareDefinitionToolInputSchema.parse(raw);
    const v3 = await sqlV3Enabled();
    if (v3) {
      const sqlDefinition = DareDefinitionV3ToolInputSchema.safeParse(parsed);
      if (!sqlDefinition.success) {
        throw new Error(
          "Dare v3 authoring requires canonical SQL, not a typed plan.",
        );
      }
      return {
        version: 3 as const,
        parsed: sqlDefinition.data,
        definition: definitionV3FromTool(sqlDefinition.data, await shortlist()),
      };
    }
    const typedDefinition = DareDefinitionV2ToolInputSchema.safeParse(parsed);
    if (!typedDefinition.success) {
      throw new Error("Dare SQL v3 authoring is not enabled in this guild.");
    }
    return {
      version: 2 as const,
      parsed: typedDefinition.data,
      definition: definitionFromTool(typedDefinition.data, await shortlist()),
    };
  };

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
        const sqlV3 = await isPolicyEnabled("dare_sql_v3", {
          server: input.capability.serverId,
        });
        return result(
          "language",
          targets.length === 0
            ? "No eligible targets are currently linked in this guild."
            : "Use only these target keys and the closed contract schema.",
          {
            authoringVersion: sqlV3 ? 3 : 2,
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
            ...(sqlV3 ? { sql: dareSqlV3Catalog() } : {}),
          },
        );
      }),
    validateScoutQl: (raw: unknown) =>
      input.track("validate_dare_scoutql", async () => {
        const parsed = DareScoutQlToolInputSchema.parse(raw);
        const targets = await resolvedTargets(parsed.targetKeys);
        if (await sqlV3Enabled()) {
          try {
            const compilation = await compileDareSqlV3({
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
        }
        const validation = await compileDareScoutQlPlanV2({
          queryText: parsed.queryText,
          targets,
        });
        return validation.kind === "invalid"
          ? result(
              "invalid_scoutql",
              "The relational ScoutQL is not a valid Dare contract query.",
              { issues: validation.issues },
            )
          : result(
              "valid_scoutql",
              "The relational ScoutQL is valid and canonically formatted.",
              {
                canonicalScoutQl: validation.compilation.canonicalScoutQl,
                planHash: validation.compilation.planHash,
                facts: validation.compilation.facts,
                plainLanguage: renderDarePlanV2(
                  validation.compilation.plan,
                  targets,
                ),
                semanticProofPlan: renderDareProofPlanV2(
                  validation.compilation.plan,
                ),
              },
            );
      }),
    validate: (raw: unknown) =>
      input.track("validate_dare_contract", async () => {
        const resolved = await definition(raw);
        if (resolved.version === 3) {
          const prepared = await prepareDareDraftV3(resolved.definition);
          return prepared.kind === "valid"
            ? result("valid", "The standard SQL dare contract is valid.", {
                canonicalSql: prepared.draft.compilation.canonicalSql,
                queryHash: prepared.draft.compilation.queryHash,
                facts: prepared.draft.compilation.facts,
                finality: prepared.draft.compilation.finality,
                plainLanguage: prepared.draft.plainLanguage,
                preview: prepared.draft.preview,
              })
            : result("invalid", "The dare contract needs revision.", {
                issues: prepared.issues,
              });
        }
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
        if (parsed.queryText !== undefined) {
          if (!(await sqlV3Enabled())) {
            return result("feature_disabled", "Dare SQL v3 is disabled.", null);
          }
          const sqlDefinition =
            DareDefinitionV3ToolInputSchema.safeParse(parsed);
          if (!sqlDefinition.success) {
            return result("invalid", "The dare contract needs revision.", {
              issues: sqlDefinition.error.issues.map((issue) => issue.message),
            });
          }
          const prepared = await prepareDareDraftV3({
            ...definitionV3FromTool(sqlDefinition.data, await shortlist()),
            historyDays: parsed.historyDays,
          });
          if (prepared.kind === "invalid") {
            return result("invalid", "The dare contract needs revision.", {
              issues: prepared.issues,
            });
          }
          return result(
            "previewed",
            "Historically executed the canonical SQL.",
            {
              ...prepared.draft.preview,
              start: new Date(
                Date.now() - parsed.historyDays * 24 * 60 * 60 * 1000,
              ).toISOString(),
              end: new Date().toISOString(),
              canonicalSql: prepared.draft.compilation.canonicalSql,
              plainLanguage: prepared.draft.plainLanguage,
            },
          );
        }
        const typedDefinition =
          DareDefinitionV2ToolInputSchema.safeParse(parsed);
        if (!typedDefinition.success) {
          return result("invalid", "The dare contract needs revision.", {
            issues: typedDefinition.error.issues.map((issue) => issue.message),
          });
        }
        const prepared = prepareDareDraftV2(
          definitionFromTool(typedDefinition.data, await shortlist()),
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
        if (resolved.version === 3) {
          const created = await createDareDraftV3({
            ...resolved.definition,
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
            originalText: created.draft.originalText,
            plainLanguage: created.draft.plainLanguage,
            semanticProofPlan:
              "The canonical SQL is the binding contract and runs directly over normalized lake relations.",
            sqlIsBinding: true,
            openingStake: created.draft.openingStake,
            targetAliases: created.draft.targets.map((target) => target.alias),
          });
        }
        const created = await createDareDraftV2({
          ...resolved.definition,
          serverId: input.capability.serverId,
          channelId: dareDraftChannel(input),
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
        const resolved = await definition({
          originalText: parsed.originalText,
          targetKeys: parsed.targetKeys,
          ...(parsed.plan === undefined ? {} : { plan: parsed.plan }),
          ...(parsed.queryText === undefined
            ? {}
            : { queryText: parsed.queryText }),
          ...(parsed.plainLanguage === undefined
            ? {}
            : { plainLanguage: parsed.plainLanguage }),
          deadlineSpec: parsed.deadlineSpec,
          openingStake: parsed.openingStake,
        });
        if (resolved.version === 3) {
          const revised = await reviseDareDraftV3({
            dareId: parsed.dareId,
            serverId: input.capability.serverId,
            challengerDiscordId: input.requesterId,
            expectedRevision: parsed.expectedRevision,
            definition: resolved.definition,
          });
          if (revised.kind !== "revised") {
            return safeDomainResult(revised, "The dare draft was not revised.");
          }
          return result("revised", "A new private SQL revision was saved.", {
            dareId: revised.dareId,
            revision: revised.revision,
            canonicalScoutQl: revised.draft.compilation.canonicalSql,
            originalText: revised.draft.originalText,
            plainLanguage: revised.draft.plainLanguage,
            semanticProofPlan:
              "The canonical SQL is the binding contract and runs directly over normalized lake relations.",
            sqlIsBinding: true,
            openingStake: revised.draft.openingStake,
            targetAliases: revised.draft.targets.map((target) => target.alias),
          });
        }
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
    ...createDareReadExecutors(input),
    ...createDareActionExecutors(input),
  };
}
