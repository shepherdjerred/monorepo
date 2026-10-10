import {
  type RiotMatchId,
  RiotMatchIdSchema,
} from "@scout-for-lol/domain/identity/brands.ts";
import { tool } from "ai";
import { z } from "zod";
import { prisma } from "#src/database/index.ts";
import { createToolPayloadCapture } from "#src/explore/inspection/tool-payloads.ts";
import type { ExploreAgentParams } from "#src/explore/analysis/agent-types.ts";
import type { ToolTracker } from "#src/reports/ai/scoutql-tools.ts";
import { executeReportQuery } from "#src/reports/query/query-engine.ts";
import {
  QueryServersSchema,
  resolveTurnScope,
} from "#src/explore/tools/server-scope.ts";
import { ReportQueryTextSchema } from "@scout-for-lol/data";
import {
  analyzeJavaScript,
  SandboxResultSchema,
} from "#src/explore/analysis/sandbox.ts";
import { readRawDocuments } from "#src/explore/analysis/raw-lake-read.ts";
import { captureAnalysisGeneration } from "#src/explore/analysis/lake-generation.ts";
import {
  JsonPathSchema,
  selectJsonValues,
} from "#src/explore/analysis/json-selection.ts";
import {
  analysisOutputForModel,
  jsonValuePage,
  queryDatasetRows,
} from "#src/explore/analysis/model-output.ts";
import { summarizeRecordedMatch } from "#src/explore/analysis/match-review.ts";

type Json = z.infer<ReturnType<typeof z.json>>;
type Dataset = {
  data: Json;
  bytes: number;
  matchIds: RiotMatchId[];
  generation: string;
  scope: QueryServers;
};
type QueryServers = z.infer<typeof QueryServersSchema>;
const NameSchema = z.string().regex(/^[a-z][a-z0-9_]{0,31}$/);
const DescriptionSchema = z.strictObject({
  dataset: NameSchema,
  rows: z.number().int().nonnegative(),
  bytes: z.number().int().nonnegative(),
  generation: z.string(),
  preview: z.json(),
  message: z.string(),
});

function schemaExample(value: Json): Json {
  if (typeof value === "string") return value.slice(0, 200);
  if (Array.isArray(value)) return [];
  return value !== null && typeof value === "object" ? {} : value;
}

/** All datasets are local to this actor/run; names are never lookup capabilities across runs. */
export function createAnalysisTools(
  params: ExploreAgentParams,
  track: ToolTracker,
) {
  const capturePayload =
    params.captureToolPayload ??
    createToolPayloadCapture(params.conversationId, params.runId);
  const datasets = new Map<string, Dataset>();
  let executions = 0;
  let queries = 0;
  const requireDataset = (name: string) => {
    const dataset = datasets.get(name);
    if (dataset === undefined)
      throw new Error(`No dataset named ${name} in this turn.`);
    return dataset;
  };
  const put = async (
    name: string,
    dataset: Omit<Dataset, "bytes">,
    stats: { rows: number; preview: Json },
    capture: { toolCallId: string; toolName: string },
  ) => {
    const { rows, preview } = stats;
    const { toolCallId, toolName } = capture;
    if (datasets.has(name))
      throw new Error("Dataset names are immutable; use a new name.");
    const bytes = new TextEncoder().encode(
      JSON.stringify(dataset.data),
    ).byteLength;
    const total = [...datasets.values()].reduce(
      (sum, value) => sum + value.bytes,
      bytes,
    );
    if (total > 64 * 1024 * 1024)
      throw new Error(
        "Datasets exceed the turn's 64 MiB limit. Narrow the query.",
      );
    datasets.set(name, { ...dataset, bytes });
    await capturePayload({
      toolCallId,
      toolName,
      direction: "dataset",
      value: dataset.data,
    });
    return {
      dataset: name,
      rows,
      bytes,
      generation: dataset.generation,
      preview,
      message:
        "The named dataset contains all selected rows; the preview is only a sample. Use analyze_javascript for calculations.",
    };
  };
  return {
    summarize_match_timeline: tool({
      description:
        "Extract deterministic facts for one player from a named raw-documents dataset: match stats and roster, complete/partial/missing timeline coverage, named deaths and objective events, gameTime labels, bounty data, and preceding team-gold snapshots. Use this first for a game review instead of writing JavaScript. Query participant_id to identify the reviewed player. Events page at most 10 at a time within 8 KiB; follow nextOffset. No Riot acquisition or model-generated calculations.",
      inputSchema: z.strictObject({
        dataset: NameSchema,
        matchId: RiotMatchIdSchema,
        participantId: z.number().int().positive(),
        offset: z.number().int().nonnegative(),
      }),
      outputSchema: z.json(),
      execute: (input) =>
        track("summarize_match_timeline", () =>
          Promise.resolve(
            z
              .json()
              .parse(
                summarizeRecordedMatch(
                  requireDataset(input.dataset).data,
                  input.matchId,
                  input.participantId,
                  input.offset,
                ),
              ),
          ),
        ),
    }),
    select_dataset_values: tool({
      description:
        "Select JSON fields with a validated path: strings name properties, integers name array indexes, {arrayElements:true} expands arrays. Pages complete observations, distinguishing absent fields from explicit null. Scalar type mismatches are reported without coercion. Use schema discovery for field names.",
      inputSchema: z.strictObject({
        dataset: NameSchema,
        path: JsonPathSchema,
        offset: z.number().int().nonnegative(),
        type: z.enum(["json", "string", "number", "boolean"]),
      }),
      outputSchema: z.strictObject({
        total: z.number().int(),
        nextOffset: z.number().int().nullable(),
        values: z.array(
          z.strictObject({
            path: z.string(),
            present: z.boolean(),
            value: z.json().nullable(),
            type: z.string(),
          }),
        ),
        mismatches: z.number().int(),
      }),
      execute: (input) =>
        track("select_dataset_values", () => {
          const all = selectJsonValues(
            requireDataset(input.dataset).data,
            input.path,
          );
          const values = jsonValuePage(all, input.offset);
          return Promise.resolve({
            total: all.length,
            nextOffset:
              input.offset + values.length < all.length
                ? input.offset + values.length
                : null,
            values,
            mismatches:
              input.type === "json"
                ? 0
                : all.filter(
                    (entry) =>
                      entry.present &&
                      entry.type !== "null" &&
                      entry.type !== input.type,
                  ).length,
          });
        }),
    }),
    materialize_query_dataset: tool({
      description:
        "Run validated ScoutQL into a named complete dataset (up to 50,000 selected rows, 64 MiB per turn). Load data-analysis first. Group by match_id to select complete raw match/timeline documents. Grouping fields retain canonical keys; __group_labels maps grouping names to display labels, including player names. Never resolve numeric player keys as Riot names. Choose an explicit LIMIT and deterministic ORDER BY. Preview rows are a sample, not the dataset.",
      inputSchema: z.strictObject({
        name: NameSchema,
        queryText: ReportQueryTextSchema,
        servers: QueryServersSchema,
      }),
      outputSchema: DescriptionSchema,
      execute: (input, { toolCallId }) =>
        track("materialize_query_dataset", async () => {
          if (++queries > 20)
            throw new Error("This turn has used its 20 dataset queries.");
          const scope = resolveTurnScope(input.servers, params.guildIds);
          if (!scope.ok) throw new Error(scope.message);
          const before = await captureAnalysisGeneration();
          const result = await executeReportQuery({
            prisma,
            queryText: input.queryText,
            scope: scope.scope,
            askerGuildIds: scope.guildIds,
            rowLimitCeiling: 50_001,
            abortSignal: params.abortSignal,
          });
          if (result.rows.length > 50_000 || result.plan.limit > 50_000)
            throw new Error(
              "Select at most 50,000 rows with an explicit LIMIT; narrow or aggregate this query.",
            );
          const data = z.json().parse(
            queryDatasetRows(
              result.plan.groupings.map((group) => group.name),
              result.rows,
            ),
          );
          const idGrouping = result.plan.groupings.findIndex(
            (group) =>
              group.kind === "column" &&
              (group.column === "match_id" || group.column === "dedupe_key"),
          );
          const matchIds =
            idGrouping === -1
              ? []
              : result.rows.flatMap((row) => {
                  const id = row.keys[idGrouping];
                  return typeof id === "string"
                    ? [RiotMatchIdSchema.parse(id.replace(":", "_"))]
                    : [];
                });
          const current = await captureAnalysisGeneration();
          if (before.id !== current.id)
            throw new Error(
              "The lake generation changed during the query; materialize the selection again.",
            );
          const generation = current.id;
          return await put(
            input.name,
            {
              data,
              matchIds: [...new Set(matchIds)],
              generation,
              scope: input.servers,
            },
            {
              rows: result.rows.length,
              preview: Array.isArray(data) ? data.slice(0, 10) : data,
            },
            { toolCallId, toolName: "materialize_query_dataset" },
          );
        }),
    }),
    materialize_raw_documents: tool({
      description:
        "Read every captured JSON field for matches selected by a named query dataset's match_id (or prematch dedupe_key) grouping. Includes unknown fields, nested kill damage, challenges, perks and frame stats. Missing documents are explicitly reported. No automatic timeline acquisition. Spectator credentials are excluded.",
      inputSchema: z.strictObject({
        name: NameSchema,
        fromDataset: NameSchema,
        kinds: z
          .array(z.enum(["match", "prematch", "timeline"]))
          .min(1)
          .max(3),
      }),
      outputSchema: DescriptionSchema,
      execute: (input, { toolCallId }) =>
        track("materialize_raw_documents", async () => {
          const from = requireDataset(input.fromDataset);
          if (from.matchIds.length === 0)
            throw new Error(
              "Select games by grouping the query dataset on match_id or dedupe_key first.",
            );
          const raw = await readRawDocuments({
            matchIds: from.matchIds,
            kinds: input.kinds,
            signal: params.abortSignal,
          });
          if (raw.generation !== from.generation)
            throw new Error(
              "The lake generation changed; materialize the selection again.",
            );
          const coverage = new Set(
            raw.documents.map(
              (document) => `${document.matchId}:${document.kind}`,
            ),
          );
          const missing = from.matchIds.flatMap((matchId) =>
            input.kinds
              .filter((kind) => !coverage.has(`${matchId}:${kind}`))
              .map((kind) => ({ matchId, kind })),
          );
          const data = z.json().parse({ documents: raw.documents, missing });
          return await put(
            input.name,
            {
              data,
              matchIds: from.matchIds,
              generation: raw.generation,
              scope: from.scope,
            },
            {
              rows: raw.documents.length,
              preview: {
                documents: raw.documents
                  .slice(0, 10)
                  .map(
                    ({
                      document: _document,
                      identityMap: _identityMap,
                      ...metadata
                    }) => metadata,
                  ),
                missing: missing.slice(0, 10),
                missingCount: missing.length,
              },
            },
            { toolCallId, toolName: "materialize_raw_documents" },
          );
        }),
    }),
    inspect_dataset_schema: tool({
      description:
        "Discover all JSON paths and observed types in a dataset, including future Riot fields. Pages every path; array elements use []. Presence counts are observations, not match counts. Missing paths differ from explicit nulls.",
      inputSchema: z.strictObject({
        dataset: NameSchema,
        offset: z.number().int().nonnegative(),
      }),
      outputSchema: z.strictObject({
        total: z.number().int(),
        nextOffset: z.number().int().nullable(),
        paths: z.array(
          z.strictObject({
            path: z.string(),
            types: z.array(z.string()),
            observations: z.number().int(),
            example: z.json(),
          }),
        ),
      }),
      execute: (input) =>
        track("inspect_dataset_schema", () => {
          const paths = new Map<
            string,
            { types: Set<string>; observations: number; example: Json }
          >();
          const visit = (value: Json, key: string) => {
            const type =
              value === null
                ? "null"
                : Array.isArray(value)
                  ? "array"
                  : typeof value;
            const seen = paths.get(key) ?? {
              types: new Set<string>(),
              observations: 0,
              example: schemaExample(value),
            };
            seen.types.add(type);
            seen.observations++;
            paths.set(key, seen);
            if (Array.isArray(value))
              for (const item of value) visit(item, `${key}[]`);
            else if (value !== null && typeof value === "object")
              for (const [name, item] of Object.entries(value))
                visit(item, `${key}[${JSON.stringify(name)}]`);
          };
          visit(requireDataset(input.dataset).data, "$");
          const all = [...paths].toSorted(([a], [b]) => a.localeCompare(b));
          return Promise.resolve({
            total: all.length,
            nextOffset:
              input.offset + 25 < all.length ? input.offset + 25 : null,
            paths: all
              .slice(input.offset, input.offset + 25)
              .map(([key, value]) => ({
                path: key,
                types: [...value.types].toSorted(),
                observations: value.observations,
                example: value.example,
              })),
          });
        }),
    }),
    analyze_javascript: tool({
      description:
        "Analyze named datasets with synchronous JavaScript. Code is a function body receiving datasets (an object keyed by name); return compact JSON aggregates and selected events. Results above 8 KiB are stored in a new named dataset: use select_dataset_values on that dataset to retrieve specific facts without recomputing. Include display names from __group_labels when reporting grouped players. Use joins, ordered streaks, array expansion and nested damage analysis. No process, filesystem, network, secrets or imports. 10 seconds, 256 MiB, 64 KiB computation output, four executions per turn.",
      inputSchema: z.strictObject({
        datasets: z.array(NameSchema).min(1).max(8),
        code: z.string().min(1).max(32_768),
      }),
      outputSchema: z.union([
        SandboxResultSchema,
        DescriptionSchema.extend({ ok: z.literal(true) }),
      ]),
      execute: (input, { toolCallId }) =>
        track("analyze_javascript", async () => {
          if (++executions > 4)
            return {
              ok: false,
              message: "This turn has used its four JavaScript executions.",
            };
          const selected = Object.fromEntries(
            input.datasets.map((name) => [name, requireDataset(name).data]),
          );
          const result = await analyzeJavaScript({
            code: input.code,
            datasets: JSON.stringify(selected),
            signal: params.abortSignal,
          });
          const bounded = analysisOutputForModel(result);
          if (result.ok && !bounded.ok) {
            const source = requireDataset(input.datasets[0] ?? "");
            const name = `analysis_result_${globalThis.crypto.randomUUID().slice(0, 8)}`;
            const description = await put(
              name,
              {
                data: result.value,
                generation: source.generation,
                scope: source.scope,
                matchIds: [],
              },
              {
                rows: Array.isArray(result.value) ? result.value.length : 1,
                preview: { stored: true },
              },
              { toolCallId, toolName: "analyze_javascript" },
            );
            return {
              ok: true as const,
              ...description,
              message:
                "The complete calculation result exceeds 8 KiB and is stored in this named dataset. Use select_dataset_values with specific scalar or event paths; do not repeat the calculation or dump entire frames.",
            };
          }
          await capturePayload({
            toolCallId,
            toolName: "analyze_javascript",
            direction: "dataset",
            value: result,
          });
          return bounded;
        }),
    }),
  };
}
