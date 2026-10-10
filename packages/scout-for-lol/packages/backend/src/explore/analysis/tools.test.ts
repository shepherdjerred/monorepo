import { expect, test, vi } from "vitest";
import { z } from "zod";
import {
  DiscordAccountIdSchema,
  ReportQueryTextSchema,
} from "@scout-for-lol/data";
import { createAnalysisTools } from "./tools.ts";
import type * as SandboxModule from "./sandbox.ts";

vi.mock("#src/reports/query/query-engine.ts", () => ({
  executeReportQuery: vi.fn(async () => ({
    plan: {
      groupings: [{ name: "match_id", kind: "column", column: "match_id" }],
      limit: 1,
    },
    rows: [{ keys: ["EUW1_123"], dimensions: ["EUW1_123"], values: [] }],
  })),
}));
vi.mock("#src/explore/analysis/lake-generation.ts", () => ({
  captureAnalysisGeneration: vi.fn(async () => ({ id: "frozen-generation" })),
}));
vi.mock("#src/explore/analysis/sandbox.ts", async (original) => ({
  ...(await original<typeof SandboxModule>()),
  analyzeJavaScript: vi.fn(async () => ({
    ok: true,
    value: {
      events: Array.from({ length: 30 }, (_, index) => ({
        index,
        detail: "x".repeat(500),
      })),
    },
  })),
}));

test("oversized calculations remain selectively readable without spending another execution", async () => {
  const capture = vi.fn(async () => {
    /* Private evidence is captured without a database write. */
  });
  const tools = createAnalysisTools(
    {
      runId: "analysis-test-run",
      conversationId: "analysis-test-conversation",
      subject: { kind: "system", id: "analysis-test" },
      question: "Review a match",
      history: [],
      guildIds: [],
      requesterId: DiscordAccountIdSchema.parse("100000000000000001"),
      originChannelId: null,
      surface: "web",
      abortSignal: new AbortController().signal,
      emit: () => {
        /* No streamed events are needed by this tool test. */
      },
      captureToolPayload: capture,
    },
    async (_name, execute) => await execute(),
  );
  const options = { toolCallId: "test-call", messages: [], context: {} };
  await tools.materialize_query_dataset.execute?.(
    {
      name: "games",
      queryText: ReportQueryTextSchema.parse(
        "SELECT match_id FROM match_participants GROUP BY match_id ORDER BY match_id ASC LIMIT 1",
      ),
      servers: null,
    },
    options,
  );
  const result = z
    .object({ ok: z.literal(true), dataset: z.string() })
    .parse(
      await tools.analyze_javascript.execute?.(
        { datasets: ["games"], code: "return {};" },
        options,
      ),
    );
  const selected = await tools.select_dataset_values.execute?.(
    {
      dataset: result.dataset,
      path: ["events", { arrayElements: true }, "index"],
      offset: 0,
      type: "number",
    },
    options,
  );
  expect(selected).toMatchObject({
    total: 30,
    nextOffset: null,
    values: Array.from({ length: 30 }, (_, index) =>
      expect.objectContaining({ value: index }),
    ),
  });
  expect(capture).toHaveBeenCalledWith(
    expect.objectContaining({
      direction: "dataset",
      toolName: "analyze_javascript",
      value: expect.objectContaining({ events: expect.any(Array) }),
    }),
  );
  for (let index = 0; index < 3; index++)
    await tools.analyze_javascript.execute?.(
      { datasets: ["games"], code: "return {};" },
      options,
    );
  expect(
    await tools.analyze_javascript.execute?.(
      { datasets: ["games"], code: "return {};" },
      options,
    ),
  ).toMatchObject({
    ok: false,
    message: expect.stringContaining("four JavaScript executions"),
  });
});
