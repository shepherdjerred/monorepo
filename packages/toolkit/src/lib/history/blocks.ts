import {
  cocoaToMs,
  loadSnapshots,
  type UsageSnapshot,
  type UsageWindow,
} from "#lib/brim/cache.ts";
import { isFiveHourWindow } from "#lib/brim/rank.ts";
import {
  HISTORY_AGENT_NAMES,
  historyAgentOf,
  sourcesOfAgent,
  type HistoryAgentName,
} from "./agents.ts";
import {
  agentParam,
  BadRequest,
  booleanParam,
  sinceParam,
} from "./api/params.ts";
import { HISTORY_API_VERSION } from "./api/schema-common.ts";
import type {
  HistoryApiBlock,
  HistoryApiBlockGap,
  HistoryApiBlockProjection,
  HistoryApiBlocksResponse,
  HistoryApiUsageTotals,
} from "./api/report-schema.ts";
import {
  addUsageTotals,
  EMPTY_USAGE_TOTALS,
  totalTokensOf,
} from "./usage-report.ts";
import type { BlockEventFilter, BlockUsageEvent } from "./usage-query.ts";

/**
 * ccusage-style 5-hour usage blocks per agent, built from indexed usage
 * events (`/v1/blocks`, `toolkit history blocks`).
 *
 * A block starts at its first event floored to the UTC hour and lasts five
 * hours; the first event at or after its end starts the next block, and the
 * idle time between two blocks is a gap. When Brim's snapshot cache holds the
 * provider's current 5-hour quota window for an agent, that window replaces
 * the derived current block: events from its start belong to it, and the
 * block before it ends no later than its start.
 */

const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
export const BLOCK_MS = 5 * HOUR_MS;
const DEFAULT_SINCE = "3d";

/** Brim provider id → the history agent whose usage that quota meters. */
export const BRIM_PROVIDER_AGENTS: Readonly<Record<string, HistoryAgentName>> =
  {
    "claude-code": "claude",
    codex: "codex",
    antigravity: "antigravity",
    cursor: "cursor",
    grok: "grok",
    kimi: "kimi",
    muse: "muse",
  };

export type BlocksQuery = {
  readonly agent: HistoryAgentName | null;
  readonly activeOnly: boolean;
  readonly since: string | null;
  /** `local`, `all`, or a mirrored machine id. */
  readonly machine: string;
};

export function parseBlocksParams(
  params: URLSearchParams,
  now: Date,
): BlocksQuery {
  const machine = params.get("machine") ?? "local";
  if (machine.length === 0) {
    throw new BadRequest("machine must be local, all, or a machine id");
  }
  return {
    agent: agentParam(params),
    activeOnly: booleanParam(params, "active"),
    since: sinceParam(params, now, DEFAULT_SINCE),
    machine,
  };
}

/** A provider's current 5-hour quota window, in Unix milliseconds. */
export type QuotaWindow = {
  readonly startMs: number;
  readonly endMs: number;
};

function usedPercent(window: UsageWindow): number {
  return window.usedPercent ?? 0;
}

/**
 * Each agent's current 5-hour quota window from Brim's snapshots: a window
 * labelled `5-hour` (rank.ts's rule) whose reset is still ahead and began at
 * most five hours ago. A provider with several (Antigravity's per-model
 * buckets) uses its most consumed, then its soonest to reset.
 */
export function activeQuotaWindows(
  snapshots: readonly UsageSnapshot[],
  nowMs: number,
): Map<HistoryAgentName, QuotaWindow> {
  const windows = new Map<HistoryAgentName, QuotaWindow>();
  for (const snapshot of snapshots) {
    const agent = BRIM_PROVIDER_AGENTS[snapshot.provider];
    if (agent === undefined) {
      continue;
    }
    const current = snapshot.windows
      .filter((window) => isFiveHourWindow(window) && window.resetAt != null)
      .map((window) => ({
        window,
        endMs: cocoaToMs(window.resetAt ?? 0),
      }))
      .filter(({ endMs }) => endMs > nowMs && endMs - BLOCK_MS <= nowMs)
      .toSorted(
        (a, b) =>
          usedPercent(b.window) - usedPercent(a.window) || a.endMs - b.endMs,
      )[0];
    if (current !== undefined) {
      windows.set(agent, {
        startMs: current.endMs - BLOCK_MS,
        endMs: current.endMs,
      });
    }
  }
  return windows;
}

/**
 * Brim's snapshot cache, or null when this machine has none (Brim never ran
 * here). A cache that exists but does not parse throws.
 */
export async function loadQuotaSnapshots(
  filePath: string,
): Promise<readonly UsageSnapshot[] | null> {
  return (await Bun.file(filePath).exists())
    ? await loadSnapshots(filePath)
    : null;
}

type TimedEvent = BlockUsageEvent & { readonly atMs: number };

type RawBlock = {
  readonly startMs: number;
  endMs: number;
  readonly events: TimedEvent[];
  readonly aligned: boolean;
};

function rollingBlocks(events: readonly TimedEvent[]): RawBlock[] {
  const blocks: RawBlock[] = [];
  let current: RawBlock | undefined;
  for (const event of events) {
    if (current === undefined || event.atMs >= current.endMs) {
      const startMs = Math.floor(event.atMs / HOUR_MS) * HOUR_MS;
      current = {
        startMs,
        endMs: startMs + BLOCK_MS,
        events: [],
        aligned: false,
      };
      blocks.push(current);
    }
    current.events.push(event);
  }
  return blocks;
}

function agentBlocks(
  events: readonly TimedEvent[],
  quota: QuotaWindow | undefined,
): RawBlock[] {
  if (quota === undefined) {
    return rollingBlocks(events);
  }
  const blocks = rollingBlocks(
    events.filter((event) => event.atMs < quota.startMs),
  );
  const last = blocks.at(-1);
  if (last !== undefined && last.endMs > quota.startMs) {
    last.endMs = quota.startMs;
  }
  const inside = events.filter((event) => event.atMs >= quota.startMs);
  if (inside.length > 0) {
    blocks.push({
      startMs: quota.startMs,
      endMs: quota.endMs,
      events: inside,
      aligned: true,
    });
  }
  return blocks;
}

function eventTotals(event: BlockUsageEvent): HistoryApiUsageTotals {
  return {
    inputTokens: event.inputTokens,
    outputTokens: event.outputTokens,
    cacheReadTokens: event.cacheReadTokens,
    cacheCreationTokens: event.cacheCreationTokens,
    cachedInputTokens: event.cachedInputTokens,
    reasoningTokens: event.reasoningTokens,
    totalTokens: totalTokensOf(event),
    events: 1,
    costUsd: event.costUsd ?? 0,
    costComplete: event.costComplete,
  };
}

/**
 * Burn rate from the block's first event to now (at least one minute, so a
 * block that just started does not divide by zero), projected to its end.
 */
export function blockProjection(
  block: {
    readonly startMs: number;
    readonly endMs: number;
    readonly firstEventMs: number;
  },
  totals: Pick<HistoryApiUsageTotals, "totalTokens" | "costUsd">,
  nowMs: number,
): HistoryApiBlockProjection {
  const measuredMs = Math.max(MINUTE_MS, nowMs - block.firstEventMs);
  const remainingMs = Math.max(0, block.endMs - nowMs);
  const tokensPerMinute = totals.totalTokens / (measuredMs / MINUTE_MS);
  const costPerHour = totals.costUsd / (measuredMs / HOUR_MS);
  return {
    elapsedMinutes: Math.floor(Math.max(0, nowMs - block.startMs) / MINUTE_MS),
    remainingMinutes: Math.ceil(remainingMs / MINUTE_MS),
    tokensPerMinute,
    costPerHour,
    projectedTokens: Math.round(
      totals.totalTokens + tokensPerMinute * (remainingMs / MINUTE_MS),
    ),
    projectedCostUsd: totals.costUsd + costPerHour * (remainingMs / HOUR_MS),
  };
}

function compareMachines(a: string | null, b: string | null): number {
  if (a === b) {
    return 0;
  }
  if (a === null) {
    return -1;
  }
  return b === null ? 1 : a.localeCompare(b);
}

function toApiBlock(
  agent: HistoryAgentName,
  block: RawBlock,
  options: { readonly isActive: boolean; readonly nowMs: number },
): HistoryApiBlock {
  const first = block.events[0];
  const last = block.events.at(-1);
  if (first === undefined || last === undefined) {
    throw new Error("A usage block has no events");
  }
  const totals = block.events
    .map((event) => eventTotals(event))
    .reduce((sum, next) => addUsageTotals(sum, next), EMPTY_USAGE_TOTALS);
  return {
    agent,
    start: new Date(block.startMs).toISOString(),
    end: new Date(block.endMs).toISOString(),
    firstEventAt: new Date(first.atMs).toISOString(),
    lastEventAt: new Date(last.atMs).toISOString(),
    isActive: options.isActive,
    alignedToQuota: block.aligned,
    machines: [...new Set(block.events.map((event) => event.machine))].toSorted(
      compareMachines,
    ),
    models: [...new Set(block.events.map((event) => event.model))].toSorted(),
    ...totals,
    projection: options.isActive
      ? blockProjection(
          { ...block, firstEventMs: first.atMs },
          totals,
          options.nowMs,
        )
      : null,
  };
}

/**
 * Builds the response from events already loaded from a block boundary (see
 * `historyBlocks`). Exported for tests that hand it events directly.
 */
export function buildBlocksResponse(
  events: readonly BlockUsageEvent[],
  query: BlocksQuery,
  quotaWindows: ReadonlyMap<HistoryAgentName, QuotaWindow>,
  now: Date,
): HistoryApiBlocksResponse {
  const nowMs = now.getTime();
  const sinceMs = query.since === null ? -Infinity : Date.parse(query.since);
  const blocks: HistoryApiBlock[] = [];
  const gaps: HistoryApiBlockGap[] = [];
  for (const [agent, agentEvents] of eventsByAgent(events)) {
    const raw = agentBlocks(agentEvents, quotaWindows.get(agent));
    raw.forEach((block, index) => {
      const isActive =
        index === raw.length - 1 &&
        block.startMs <= nowMs &&
        nowMs < block.endMs;
      const next = raw[index + 1];
      if (
        next !== undefined &&
        next.startMs > block.endMs &&
        block.endMs > sinceMs &&
        !query.activeOnly
      ) {
        gaps.push({
          agent,
          start: new Date(block.endMs).toISOString(),
          end: new Date(next.startMs).toISOString(),
        });
      }
      if (block.endMs > sinceMs && (isActive || !query.activeOnly)) {
        blocks.push(toApiBlock(agent, block, { isActive, nowMs }));
      }
    });
  }
  return {
    apiVersion: HISTORY_API_VERSION,
    now: now.toISOString(),
    since: query.since,
    machine: query.machine,
    agent: query.agent,
    activeOnly: query.activeOnly,
    blocks,
    gaps,
  };
}

/** Events grouped by agent in `HISTORY_AGENT_NAMES` order, oldest first. */
function eventsByAgent(
  events: readonly BlockUsageEvent[],
): Map<HistoryAgentName, TimedEvent[]> {
  const grouped = new Map<HistoryAgentName, TimedEvent[]>(
    HISTORY_AGENT_NAMES.map((agent) => [agent, []]),
  );
  for (const event of events) {
    const atMs = Date.parse(event.occurredAt);
    if (Number.isNaN(atMs)) {
      throw new TypeError(`Usage event time ${event.occurredAt} is not a time`);
    }
    grouped.get(historyAgentOf(event.source))?.push({ ...event, atMs });
  }
  for (const [agent, list] of grouped) {
    if (list.length === 0) {
      grouped.delete(agent);
    } else {
      list.sort((a, b) => a.atMs - b.atMs);
    }
  }
  return grouped;
}

/**
 * The index of the latest event that must start a block — its predecessor is
 * at least five hours older — at or before `sinceMs`, or -1 when the loaded
 * events do not prove one. The first loaded event qualifies when nothing was
 * loaded in the five hours before it.
 */
function chainStart(
  events: readonly TimedEvent[],
  fromMs: number,
  sinceMs: number,
): number {
  let start = -1;
  for (const [index, event] of events.entries()) {
    if (index > 0 && event.atMs > sinceMs) {
      break;
    }
    const previousMs = events[index - 1]?.atMs ?? fromMs;
    if (event.atMs - previousMs >= BLOCK_MS) {
      start = index;
    }
  }
  return start;
}

/** The index reads the block builder needs. */
export type BlockEventReader = {
  readSnapshot: <T>(callback: () => T) => T;
  blockEvents: (filter: BlockEventFilter) => BlockUsageEvent[];
  earliestUsageAt: (filter: Omit<BlockEventFilter, "from">) => string | null;
};

const INITIAL_LOOKBACK_MS = 24 * HOUR_MS;

/**
 * Loads each agent's events from a point where its block chain provably
 * restarts, so the blocks that overlap `since` match the ones a full-history
 * scan would build. The lookback doubles until every agent has such a point
 * or the whole history is loaded.
 */
function loadChainedEvents(
  reader: BlockEventReader,
  query: BlocksQuery,
): BlockUsageEvent[] {
  const scope = {
    sources: query.agent === null ? null : sourcesOfAgent(query.agent),
    machine: query.machine,
  };
  if (query.since === null) {
    return reader.blockEvents({ ...scope, from: null });
  }
  const earliest = reader.earliestUsageAt(scope);
  if (earliest === null) {
    return [];
  }
  const sinceMs = Date.parse(query.since);
  const earliestMs = Date.parse(earliest);
  for (let lookback = INITIAL_LOOKBACK_MS; ; lookback *= 2) {
    const fromMs = sinceMs - lookback;
    if (fromMs <= earliestMs) {
      return reader.blockEvents({ ...scope, from: null });
    }
    const events = reader.blockEvents({
      ...scope,
      from: new Date(fromMs).toISOString(),
    });
    const trimmed: BlockUsageEvent[] = [];
    let proven = true;
    for (const agentEvents of eventsByAgent(events).values()) {
      const start = chainStart(agentEvents, fromMs, sinceMs);
      if (start === -1) {
        proven = false;
        break;
      }
      trimmed.push(...agentEvents.slice(start));
    }
    if (proven) {
      return trimmed;
    }
  }
}

/** The `/v1/blocks` response for a parsed query. */
export function historyBlocks(
  reader: BlockEventReader,
  query: BlocksQuery,
  dependencies: {
    readonly now: Date;
    readonly snapshots: readonly UsageSnapshot[] | null;
  },
): HistoryApiBlocksResponse {
  const events = reader.readSnapshot(() => loadChainedEvents(reader, query));
  return buildBlocksResponse(
    events,
    query,
    activeQuotaWindows(
      dependencies.snapshots ?? [],
      dependencies.now.getTime(),
    ),
    dependencies.now,
  );
}
