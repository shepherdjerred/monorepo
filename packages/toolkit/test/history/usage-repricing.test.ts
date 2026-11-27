import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { MODELS, type Catalog } from "@shepherdjerred/llm-models";
import { HistoryIndex } from "#lib/history/index.ts";
import {
  defaultHistoryPaths,
  defaultHistoryRuntimePaths,
} from "#lib/history/paths.ts";
import { createHistorySources } from "#lib/history/sources.ts";
import {
  EMPTY_DOCUMENT_DETAILS,
  type UsageEventEntry,
} from "#lib/history/types.ts";
import {
  pricingCatalogFingerprint,
  repriceStoredUsageEvent,
  ZERO_USAGE,
} from "#lib/history/usage-cost.ts";

let fixtureRoot = "";

beforeAll(async () => {
  fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "toolkit-reprice-"));
});

afterAll(async () => {
  if (fixtureRoot.length > 0) {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

function repriceSourceResult(
  source: "codex" | "kimi" | "grok",
  events: readonly (Partial<UsageEventEntry> & { readonly model: string })[],
) {
  const id = `${source}-1`;
  const ts = "2026-09-01T00:00:00.000Z";
  const usageEvents = events.map((entry, idx) => ({
    ...ZERO_USAGE,
    occurredAt: `2026-09-01T00:0${String(idx)}:00.000Z`,
    inputTokens: 1_000_000,
    outputTokens: 100_000,
    costUsd: null,
    costComplete: false,
    ...entry,
  }));
  return {
    source,
    available: true,
    fingerprint: id,
    error: null,
    complete: true,
    sourceIds: [id],
    documents: [
      {
        ...EMPTY_DOCUMENT_DETAILS,
        source,
        sourceId: id,
        title: id,
        path: `/nonexistent-transcript/${id}`,
        workspace: "/fixture",
        agent: source,
        createdAt: ts,
        updatedAt: ts,
        runtimeId: id,
        openingPromptHash: null,
        dialogueText: id,
        toolOutputText: "",
        usageEvents,
      },
    ],
  };
}

describe("history index catalog repricing", () => {
  test("reprices stored usage events across opens when catalog pricing changes without re-reading transcripts", async () => {
    const runtime = defaultHistoryRuntimePaths(
      path.join(fixtureRoot, "reprice-home"),
    );
    const sample = Object.values(MODELS).find(
      (entry) => entry.pricing.modality === "text",
    );
    if (sample?.pricing.modality !== "text") throw new Error("no text model");
    const textModel = (
      id: string,
      provider: "openai" | "moonshot" | "xai",
      input: number,
      output: number,
    ) => ({
      ...sample,
      id,
      provider,
      pricing: {
        modality: "text" as const,
        input,
        cachedInput: 0.5,
        cacheRead: 0.2,
        output,
      },
      pricingOnly: true as const,
      routes: {},
    });
    const catalogV1: Catalog = {
      "codex-test-priced": textModel("codex-test-priced", "openai", 2, 10),
      "grok-priced": textModel("grok-priced", "xai", 1, 5),
    };
    const catalogV2: Catalog = {
      "codex-test-priced": textModel("codex-test-priced", "openai", 4, 20),
      "codex-newly-priced": textModel("codex-newly-priced", "openai", 5, 15),
      "kimi-k9-pro": textModel("kimi-k9-pro", "moonshot", 1, 3),
      "grok-9": textModel("grok-9", "xai", 2, 8),
      "grok-priced": textModel("grok-priced", "xai", 3, 15),
    };
    const catalogV3: Catalog = {
      ...catalogV2,
      "grok-9": textModel("grok-9", "xai", 6, 10),
      "grok-priced": textModel("grok-priced", "xai", 5, 25),
    };
    expect(pricingCatalogFingerprint(catalogV1)).not.toBe(
      pricingCatalogFingerprint(catalogV2),
    );
    const firstOpen = await HistoryIndex.open(runtime, false, {
      models: catalogV1,
    });
    await firstOpen.ingest([
      repriceSourceResult("codex", [
        { model: "codex-test-priced", cachedInputTokens: 400_000 },
        { model: "codex-newly-priced", outputTokens: 200_000 },
      ]),
      repriceSourceResult("kimi", [
        { model: "kimi-code/k9-pro", cacheReadTokens: 500_000 },
      ]),
      repriceSourceResult("grok", [
        {
          model: "xai/grok-9-build",
          cacheReadTokens: 400_000,
          costUsd: 0.77,
          costComplete: true,
          costReported: true,
        },
        { model: "xai/grok-9-build", cacheReadTokens: 400_000 },
        {
          model: "xai/grok-priced-build",
          cacheReadTokens: 400_000,
          costUsd: 1.3,
          costComplete: true,
        },
      ]),
    ]);
    expect(firstOpen.usage({ since: null, source: null }).total).toMatchObject({
      costUsd: expect.closeTo(2.4 + 0.77 + 1.3),
      costComplete: false,
    });
    firstOpen.close();

    const secondOpen = await HistoryIndex.open(runtime, false, {
      models: catalogV2,
    });
    expect(secondOpen.usage({ since: null, source: null }).total).toMatchObject(
      {
        costUsd: expect.closeTo(4.6 + 8 + 1.4 + 0.77 + 2.2 + 3.5),
        costComplete: true,
      },
    );
    expect(
      repriceStoredUsageEvent("antigravity", "gemini-x", ZERO_USAGE, catalogV2),
    ).toEqual({ costUsd: null, costComplete: true });
    secondOpen.close();

    // Reconciling a third catalog revision updates both Grok catalog-derived rows
    // (including the one first priced on v2) while keeping the reported 0.77 row fixed.
    const thirdOpen = await HistoryIndex.open(runtime, false, {
      models: catalogV3,
    });
    expect(
      thirdOpen.usage({ since: null, source: "grok" }).total,
    ).toMatchObject({
      costUsd: expect.closeTo(0.77 + 4.8 + 5.7),
      costComplete: true,
    });
    thirdOpen.close();
  });

  test("marks only Grok turns with costUsdTicks as provider-reported costs", async () => {
    const grokHome = path.join(fixtureRoot, "grok-cost-provenance");
    const sessionDir = path.join(
      grokHome,
      "sessions",
      "%2Ftest%2Ffixture",
      "grok-cost-provenance-session",
    );
    await mkdir(sessionDir, { recursive: true });
    const record = {
      timestamp: 1_788_721_616,
      params: {
        sessionId: "grok-cost-provenance-session",
        update: {
          sessionUpdate: "turn_completed",
          usage: {
            modelUsage: {
              "grok-4.20": {
                inputTokens: 1000,
                outputTokens: 100,
                costUsdTicks: 7_700_000_000,
              },
              "grok-4.20-build": {
                inputTokens: 1000,
                outputTokens: 100,
              },
            },
          },
        },
      },
    };
    await Bun.write(
      path.join(sessionDir, "updates.jsonl"),
      `${JSON.stringify(record)}\n`,
    );
    const source = createHistorySources().find(
      (entry) => entry.name === "grok",
    );
    expect(source).toBeDefined();
    const basePaths = defaultHistoryPaths(fixtureRoot);
    const result = await source?.scan({ ...basePaths, grokHome });
    const events = result?.documents[0]?.usageEvents ?? [];
    expect(events).toHaveLength(2);
    const reported = events.find((entry) => entry.model === "grok-4.20");
    const estimated = events.find((entry) => entry.model === "grok-4.20-build");
    expect(reported?.costReported).toBe(true);
    expect(reported?.costUsd).toBeCloseTo(0.77);
    expect(estimated?.costReported).toBeUndefined();
  });
});
