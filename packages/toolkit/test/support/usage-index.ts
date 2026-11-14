import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  COCOA_EPOCH_OFFSET_SECONDS,
  defaultSnapshotsPath,
} from "#lib/brim/cache.ts";
import { handleHistoryApiRequest } from "#lib/history/api/handler.ts";
import { loadQuotaSnapshots } from "#lib/history/blocks.ts";
import { CaptureStore } from "#lib/history/captures/store.ts";
import { HistoryIndex } from "#lib/history/index.ts";
import { defaultHistoryRuntimePaths } from "#lib/history/paths.ts";
import {
  EMPTY_DOCUMENT_DETAILS,
  type HistoryDocument,
  type HistorySourceName,
  type HistorySourceResult,
  type UsageEventEntry,
} from "#lib/history/types.ts";

/** Synthetic usage events in a temporary history index, for report tests. */

export type SyntheticEvent = {
  readonly at: string;
  readonly model?: string;
  readonly input?: number;
  readonly output?: number;
  readonly cacheRead?: number;
  readonly cacheWrite?: number;
  /** Null is an unpriced model. */
  readonly costUsd?: number | null;
};

export type SyntheticSession = {
  readonly source: HistorySourceName;
  readonly id: string;
  readonly machine?: string;
  readonly workspace?: string;
  readonly events: readonly SyntheticEvent[];
};

function usageEvent(event: SyntheticEvent): UsageEventEntry {
  const costUsd = event.costUsd === undefined ? 0.01 : event.costUsd;
  const tokens = {
    inputTokens: event.input ?? 100,
    outputTokens: event.output ?? 10,
    cacheReadTokens: event.cacheRead ?? 0,
    cacheCreationTokens: event.cacheWrite ?? 0,
  };
  const billable = Object.values(tokens).some((value) => value > 0);
  return {
    occurredAt: event.at,
    model: event.model ?? "claude-opus-5-5",
    ...tokens,
    cachedInputTokens: 0,
    reasoningTokens: 0,
    costUsd,
    costComplete: costUsd !== null || !billable,
  };
}

function document(session: SyntheticSession): HistoryDocument {
  const times = session.events.map((event) => event.at).toSorted();
  const updatedAt = times.at(-1) ?? "2026-11-01T00:00:00.000Z";
  return {
    ...EMPTY_DOCUMENT_DETAILS,
    source: session.source,
    sourceId: session.id,
    title: `Synthetic ${session.id}`,
    path: `/fixture/${session.id}`,
    workspace: session.workspace ?? "/repo/alpha",
    agent: "fixture",
    createdAt: times[0] ?? updatedAt,
    updatedAt,
    runtimeId: session.id,
    openingPromptHash: null,
    dialogueText: "synthetic usage fixture",
    toolOutputText: "",
    usageEvents: session.events.map((event) => usageEvent(event)),
    machine: session.machine ?? null,
  };
}

export type UsageFixture = {
  readonly home: string;
  readonly index: HistoryIndex;
  readonly store: CaptureStore;
  /** Calls the read API with a fixed clock and the home's Brim cache. */
  readonly get: (
    pathAndQuery: string,
    now?: Date,
  ) => Promise<{ status: number; body: unknown }>;
  readonly close: () => Promise<void>;
};

export async function usageFixture(
  sessions: readonly SyntheticSession[],
  defaultNow: Date = new Date("2026-11-14T12:00:00.000Z"),
): Promise<UsageFixture> {
  const home = await mkdtemp(path.join(os.tmpdir(), "toolkit-usage-"));
  const runtimePaths = defaultHistoryRuntimePaths(home);
  const index = await HistoryIndex.open(runtimePaths);
  const bySource = new Map<HistorySourceName, HistoryDocument[]>();
  for (const session of sessions) {
    bySource.set(session.source, [
      ...(bySource.get(session.source) ?? []),
      document(session),
    ]);
  }
  await index.ingest(
    [...bySource].map(([source, documents]): HistorySourceResult => ({
      source,
      available: true,
      documents,
      fingerprint: `${source}-fixture`,
      error: null,
      complete: true,
      sourceIds: documents.map((entry) => entry.sourceId),
    })),
  );
  const store = await CaptureStore.open(runtimePaths.capturesDb);
  return {
    home,
    index,
    store,
    get: async (pathAndQuery, now = defaultNow) => {
      const response = await handleHistoryApiRequest(
        {
          index,
          captures: store,
          readMessages: () =>
            Promise.resolve({ messages: new Map(), warnings: [] }),
          now: () => now,
          loadQuotaSnapshots: () =>
            loadQuotaSnapshots(defaultSnapshotsPath(home)),
        },
        new Request(`http://history${pathAndQuery}`),
      );
      if (response === null) {
        throw new Error(`${pathAndQuery} was not routed to the API`);
      }
      return { status: response.status, body: await response.json() };
    },
    close: async () => {
      store.close();
      index.close();
      await rm(home, { recursive: true, force: true });
    },
  };
}

export type SyntheticQuotaWindow = {
  readonly label: string;
  readonly resetAt: string | null;
  readonly usedPercent?: number;
};

function cocoa(iso: string): number {
  return Date.parse(iso) / 1000 - COCOA_EPOCH_OFFSET_SECONDS;
}

/** Writes Brim's `snapshots.json` (Swift `Date`s are Cocoa seconds). */
export async function writeSnapshots(
  home: string,
  providers: Readonly<Record<string, readonly SyntheticQuotaWindow[]>>,
): Promise<void> {
  const filePath = defaultSnapshotsPath(home);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(
    filePath,
    JSON.stringify(
      Object.entries(providers).map(([provider, windows]) => ({
        provider,
        windows: windows.map((window, position) => ({
          id: `${provider}-${String(position)}`,
          label: window.label,
          kind: { rolling: {} },
          usedPercent: window.usedPercent ?? 10,
          resetAt: window.resetAt === null ? null : cocoa(window.resetAt),
          sourceTimestamp: cocoa("2026-11-14T00:00:00.000Z"),
        })),
        sourceTimestamp: cocoa("2026-11-14T00:00:00.000Z"),
      })),
    ),
  );
}
