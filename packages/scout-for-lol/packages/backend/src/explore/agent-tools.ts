import { tool } from "ai";
import { z } from "zod";
import {
  type DiscordAccountId,
  EXPLORE_MAX_PREVIEW_CALLS,
  EXPLORE_MAX_TOOL_CALLS,
  ReportQueryTextSchema,
  type DiscordChannelId,
  type ExploreMessage,
  type ExploreStreamEvent,
  type ReportAiPreviewSummary,
  type VisualizationSnapshot,
} from "@scout-for-lol/data";
import { quoteScoutQlString } from "@scout-for-lol/data/model/scoutql/editor/format-expr.ts";
import type { ScoutQlSource } from "@scout-for-lol/data/model/scoutql/parse/plan.ts";
import type { LlmSubject } from "@shepherdjerred/llm-observability/subject";
import { prisma } from "#src/database/index.ts";
import type { CreationCapability } from "#src/explore/creation/capability.ts";
import { emptyResultReason } from "#src/explore/empty-result-reason.ts";
import { createGatedExploreTools } from "#src/explore/gated-tools.ts";
import { ScopeRefusedError } from "#src/reports/duckdb/plan-source.ts";
import {
  QueryServersSchema,
  createListMyServersTool,
  resolveTurnScope,
} from "#src/explore/tools/server-scope.ts";
import type { HallExploreCapability } from "#src/explore/tools/hall-tools.ts";
import {
  enabledExploreSkills,
  type ExploreSkillOptions,
} from "#src/explore/skills/registry.ts";
import { createLoadSkillTool } from "#src/explore/skills/tool.ts";
import type { ExploreSurface } from "#src/explore/surface.ts";
import { type BucksExploreCapability } from "#src/explore/tools/bucks-tools.ts";
import { createClashExploreTools } from "#src/explore/tools/clash-tools.ts";
import { createLeagueExploreTools } from "#src/explore/tools/league-tools.ts";
import { type MvpVotesExploreCapability } from "#src/explore/tools/mvp-votes-tools.ts";
import {
  isExploreMatchSnapshotSupported,
  matchIdsInPreview,
} from "#src/explore-match/match-view.ts";
import { scoutExploreToolCallsTotal } from "#src/metrics/explore.ts";
import {
  reportQueryModelPreviewSummary,
  reportQueryPreviewSummary,
} from "#src/reports/ai/report-query-preview-summary.ts";
import {
  createFormatTool,
  createValidateTool,
  QueryResultToolOutputSchema,
  validateQuery,
  type ToolTracker,
} from "#src/reports/ai/scoutql-tools.ts";
import { fetchMatchSupport } from "#src/reports/duckdb/consumer-profile-lake-reads.ts";
import { resolvePlayerIdentities } from "#src/reports/identity.ts";
import { executeReportQuery } from "#src/reports/query/query-engine.ts";

export type ExploreAgentParams = {
  runId: string;
  conversationId: string;
  /**
   * Who this turn is being answered for. Required rather than optional: an
   * Explore turn always has an asker, and an optional field would quietly
   * produce unattributed spend the first time a caller forgot it.
   */
  subject: LlmSubject;
  question: string;
  /** Prior turns of this conversation, oldest first. */
  history: ExploreMessage[];
  /**
   * The asker's Discord servers, used only to resolve a `player('…')` alias.
   * Explore is global otherwise; this is the one lookup that reads per-server
   * data, so it stays bounded to servers this person belongs to.
   */
  guildIds: string[];
  /**
   * The asker. Only the Bryan Bucks account tool reads it — the tool is
   * structurally scoped to the requester's own balance.
   */
  requesterId: DiscordAccountId;
  /** Discord-originated dare drafts keep the invoking channel as metadata. */
  originChannelId: DiscordChannelId | null;
  /**
   * Which product surface this turn is answered on. Creation tools are
   * web-only; see `explore/surface.ts` for why that is structural rather than
   * a policy choice.
   */
  surface: ExploreSurface;
  abortSignal: AbortSignal;
  emit: (event: ExploreStreamEvent) => void | Promise<void>;
};

export type RunState = {
  toolCalls: number;
  previewCalls: number;
  /** Result of the most recent successful query, attached to the answer. */
  lastPreview: ReportAiPreviewSummary | null;
  lastVisualization: VisualizationSnapshot | null;
  /** Match ids from the most recent query that support a two-team card. */
  lastMatchIds: Set<string>;
  /** Every match id in the most recent query, including card-ineligible modes. */
  lastQueryMatchIds: Set<string>;
  /** Skills loaded this turn, so result messages can stop nudging. */
  loadedSkills: Set<string>;
};

type ExploreToolsOptions = {
  params: ExploreAgentParams;
  state: RunState;
  skillOptions: ExploreSkillOptions;
  bucksCapability: BucksExploreCapability | null;
  mvpVotesCapability: MvpVotesExploreCapability | null;
  daresEnabled: boolean;
  challengesEnabled: boolean;
  creationCapability: CreationCapability | null;
  riotHistoryEnabled: boolean;
  clashEnabled: boolean;
  hallCapability: HallExploreCapability | null;
};

export function createExploreTools(options: ExploreToolsOptions) {
  const {
    params,
    state,
    skillOptions,
    bucksCapability,
    mvpVotesCapability,
    daresEnabled,
    challengesEnabled,
    creationCapability,
    riotHistoryEnabled,
    clashEnabled,
    hallCapability,
  } = options;
  const track: ToolTracker = async (toolName, work) => {
    state.toolCalls++;
    if (state.toolCalls > EXPLORE_MAX_TOOL_CALLS) {
      scoutExploreToolCallsTotal.inc({
        tool_name: toolName,
        status: "limited",
      });
      throw new Error("This question used too many steps. Try a simpler one.");
    }
    try {
      const result = await work();
      scoutExploreToolCallsTotal.inc({
        tool_name: toolName,
        status: "success",
      });
      return result;
    } catch (error) {
      scoutExploreToolCallsTotal.inc({ tool_name: toolName, status: "error" });
      throw error;
    }
  };

  /**
   * Who a name means, before a query is spent on it.
   *
   * `player('…')` resolves the same way at execution, so this is not required
   * for correctness — it exists so the agent can disambiguate a name that
   * matches two people, and can tell the reader which accounts an answer
   * folded together. Its output deliberately carries PUUIDs for the model's
   * own reasoning only; they never reach query text, which is what the
   * `player('…')` call form is for.
   */
  const resolvePlayer = tool({
    description:
      "Find out who a name refers to before querying: accepts a Scout alias, a Riot ID, or a game name, and returns each matching person with every account and past Riot ID they have used. Use the returned displayName inside player('…'). Pass the same servers the query will use, so a server nickname resolves where it will run.",
    inputSchema: z
      .object({
        query: z.string().min(1).max(100),
        servers: QueryServersSchema,
      })
      .strict(),
    outputSchema: z
      .object({
        candidates: z.array(
          z.object({
            displayName: z.string(),
            riotIds: z.array(z.string()),
            accounts: z.number(),
            games: z.number(),
            firstSeen: z.string(),
            lastSeen: z.string(),
            matchedBy: z.enum(["alias", "riot_id"]),
          }),
        ),
        message: z.string(),
      })
      .strict(),
    execute: (inputData) =>
      track("resolve_player", async () => {
        const turn = resolveTurnScope(inputData.servers, params.guildIds);
        if (!turn.ok) {
          return { candidates: [], message: turn.message };
        }
        const found = await resolvePlayerIdentities({
          query: inputData.query,
          guildIds: turn.guildIds,
        });
        return {
          candidates: found.map((identity) => ({
            displayName: identity.displayName,
            riotIds: identity.riotIds,
            accounts: identity.puuids.length,
            games: identity.games,
            firstSeen: identity.firstSeen,
            lastSeen: identity.lastSeen,
            matchedBy: identity.matchedBy,
          })),
          message:
            found.length === 0
              ? `No player matches "${inputData.query}". Say the data does not cover them rather than guessing at a similar name.`
              : found.length === 1
                ? `One match. Use player(${quoteScoutQlString(found[0]?.displayName ?? inputData.query)}) in the query.`
                : `${found.length.toString()} people match. Ask which one they meant before querying.`,
        };
      }),
  });

  const runReportQuery = tool({
    description:
      "Run a valid ScoutQL query and return the resulting rows: over all ingested match data, or, with servers, over those servers' tracked players. Every statistic you state must come from a result of this tool.",
    inputSchema: z
      .object({ queryText: ReportQueryTextSchema, servers: QueryServersSchema })
      .strict(),
    outputSchema: QueryResultToolOutputSchema,
    execute: (inputData) =>
      track("run_report_query", async () => {
        state.previewCalls++;
        if (state.previewCalls > EXPLORE_MAX_PREVIEW_CALLS) {
          throw new Error("This question ran too many queries.");
        }
        const validation = validateQuery(inputData.queryText);
        if (!validation.ok || validation.formattedQueryText === null) {
          return {
            ok: false,
            message: validation.message,
            formattedQueryText: null,
            preview: null,
          };
        }
        const turn = resolveTurnScope(inputData.servers, params.guildIds);
        if (!turn.ok) {
          return {
            ok: false,
            message: turn.message,
            formattedQueryText: null,
            preview: null,
          };
        }

        let source: ScoutQlSource | null = null;
        // Held on an object rather than a bare `let`: the assignment happens
        // inside `onPlan`, so a plain local narrows to `null` for the reader
        // below and the comparison lints as always-true.
        const planFacts: { emptyReason: string | null } = { emptyReason: null };
        const result = await executeReportQuery({
          prisma,
          scope: turn.scope,
          askerGuildIds: turn.guildIds,
          queryText: validation.formattedQueryText,
          onPlan: (plan) => {
            source = plan.source;
            planFacts.emptyReason = emptyResultReason(plan);
          },
        }).catch((error: unknown) => {
          // A scope the model chose that the source cannot serve is its
          // mistake to correct, not a failure: say how. A bare error made it
          // retry the same call until the turn gave up.
          if (error instanceof ScopeRefusedError) {
            return {
              refused: `${error.message} Run it again with servers null.`,
            };
          }
          throw error;
        });
        if ("refused" in result) {
          return {
            ok: false,
            message: result.refused,
            formattedQueryText: validation.formattedQueryText,
            preview: null,
          };
        }
        const preview = reportQueryPreviewSummary(result);
        const modelPreview = reportQueryModelPreviewSummary(result);
        state.lastPreview = preview;
        state.lastVisualization = result.visualization ?? null;
        state.lastQueryMatchIds = matchIdsInPreview(preview, source);
        const cardSupportRows =
          params.surface === "web" || params.surface === "voice"
            ? await fetchMatchSupport([...state.lastQueryMatchIds])
            : [];
        state.lastMatchIds = new Set(
          cardSupportRows
            .filter((row) =>
              isExploreMatchSnapshotSupported(row.queue_id, row.game_mode),
            )
            .map((row) => row.match_id),
        );

        await params.emit({
          type: "preview",
          preview,
          visualization: result.visualization ?? null,
        });
        return {
          ok: true,
          message: [
            preview.rowsReturned === 0
              ? [
                  `No rows matched after scanning ${preview.rowsScanned.toString()} rows. The data does not cover this — say so rather than estimating.`,
                  ...(planFacts.emptyReason === null
                    ? []
                    : [planFacts.emptyReason]),
                ].join(" ")
              : `Returned ${preview.rowsReturned.toString()} rows after scanning ${preview.rowsScanned.toString()} rows.`,
            state.lastMatchIds.size === 0
              ? "This query has no supported match cards. Set matchCards to []."
              : `For this query, cards may use only these match_id values: ${[...state.lastMatchIds].join(", ")}.`,
            ...(state.loadedSkills.has("visualization")
              ? []
              : [
                  "Before attaching a visualization, load the visualization skill.",
                ]),
          ].join(" "),
          formattedQueryText: validation.formattedQueryText,
          preview: modelPreview,
        };
      }),
  });

  // The system prompt carries the full language reference, so the
  // `get_report_language` reference tool is not registered here.
  return {
    load_skill: createLoadSkillTool({
      skills: enabledExploreSkills(skillOptions),
      context: {
        bucks: skillOptions.bucks,
        mvpVotes: skillOptions.mvpVotes ?? null,
        surface: params.surface,
      },
      track,
      onLoaded: (name) => state.loadedSkills.add(name),
    }),
    resolve_player: resolvePlayer,
    list_my_servers: createListMyServersTool({
      db: prisma,
      guildIds: params.guildIds,
      track,
    }),
    validate_report_query: createValidateTool(track),
    run_report_query: runReportQuery,
    format_report_query: createFormatTool(track),
    ...createLeagueExploreTools({
      requesterId: params.requesterId,
      guildIds: params.guildIds,
      riotHistoryEnabled,
      eligibleTimelineMatchIds: () => state.lastQueryMatchIds,
      track,
    }),
    ...createGatedExploreTools({
      bucksCapability,
      mvpVotesCapability,
      daresEnabled,
      challengesEnabled,
      creationCapability,
      hallCapability,
      requesterId: params.requesterId,
      guildIds: params.guildIds,
      conversationId: params.conversationId,
      originChannelId: params.originChannelId,
      track,
    }),
    ...(clashEnabled
      ? createClashExploreTools({
          guildIds: params.guildIds,
          track,
        })
      : {}),
  };
}
