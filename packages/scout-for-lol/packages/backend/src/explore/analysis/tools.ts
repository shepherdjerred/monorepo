import {
  type RiotMatchId,
  RiotMatchIdSchema,
} from "@scout-for-lol/domain/identity/brands.ts";
import { tool } from "ai";
import { z } from "zod";
import { prisma } from "#src/database/index.ts";
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
    await prisma.exploreToolPayload.create({
      data: {
        conversationId: params.conversationId,
        runId: params.runId,
        toolCallId,
        toolName,
        direction: "dataset",
        payload: JSON.stringify(dataset.data),
      },
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
          const values = all.slice(input.offset, input.offset + 100);
          if (
            new TextEncoder().encode(JSON.stringify(values)).byteLength > 65_536
          )
            throw new Error(
              "Selected values exceed 64 KiB. Select a scalar child path or analyze the dataset in JavaScript.",
            );
          return Promise.resolve({
            total: all.length,
            nextOffset:
              input.offset + 100 < all.length ? input.offset + 100 : null,
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
        "Run validated ScoutQL into a named complete dataset (up to 50,000 selected rows, 64 MiB per turn). Load data-analysis first. Group by match_id to select complete raw match/timeline documents. Choose an explicit LIMIT and deterministic ORDER BY. Preview rows are a sample, not the dataset.",
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
            result.rows.map((row) => ({
              ...Object.fromEntries(
                result.plan.groupings.map((group, index) => [
                  group.name,
                  row.keys[index],
                ]),
              ),
              ...Object.fromEntries(
                row.values.map((value) => [value.column, value.value]),
              ),
            })),
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
              input.offset + 100 < all.length ? input.offset + 100 : null,
            paths: all
              .slice(input.offset, input.offset + 100)
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
        "Analyze named datasets with synchronous JavaScript. Code is a function body receiving datasets (an object keyed by name); return JSON. Use joins, ordered streaks, array expansion and nested damage analysis. No process, filesystem, network, secrets or imports. 10 seconds, 256 MiB, 64 KiB output, four executions per turn.",
      inputSchema: z.strictObject({
        datasets: z.array(NameSchema).min(1).max(8),
        code: z.string().min(1).max(32_768),
      }),
      outputSchema: SandboxResultSchema,
      execute: (input) =>
        track("analyze_javascript", async () => {
          if (++executions > 4)
            return {
              ok: false,
              message: "This turn has used its four JavaScript executions.",
            };
          const selected = Object.fromEntries(
            input.datasets.map((name) => [name, requireDataset(name).data]),
          );
          return await analyzeJavaScript({
            code: input.code,
            datasets: JSON.stringify(selected),
            signal: params.abortSignal,
          });
        }),
    }),
  };
}
