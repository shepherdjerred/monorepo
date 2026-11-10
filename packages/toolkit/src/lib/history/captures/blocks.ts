import { z } from "zod";
import {
  BLOCK_CATEGORIES,
  BLOCK_SECTIONS,
  type BlockCategory,
  type BlockSection,
  type ParsedBlock,
} from "./request.ts";
import type { CaptureStore } from "./store.ts";

/**
 * A capture's context is an ordered list of block references. Diffing two
 * requests' lists gives the blocks a request added — what a span for that
 * request would carry — and the context-size breakdown.
 */

const PREVIOUS_CANDIDATES = 20;

export type BlockRef = {
  readonly section: BlockSection;
  readonly category: BlockCategory;
  readonly hash: string;
  readonly identity: string;
  readonly bytes: number;
  /** Not sent by this request; rebuilt from the request it continues. */
  readonly inherited: boolean;
  /** Set for blocks first seen in this request; inherited ones are stored. */
  readonly json?: string;
};

export function fromParsed(block: ParsedBlock, inherited = false): BlockRef {
  return { ...block, inherited };
}

const BlockRowSchema = z.object({
  section: z.enum(BLOCK_SECTIONS),
  category: z.enum(BLOCK_CATEGORIES),
  hash: z.string(),
  identity: z.string(),
  bytes: z.number(),
  inherited: z.number(),
});

const SECTION_ORDER =
  "CASE section WHEN 'system' THEN 0 WHEN 'tools' THEN 1 ELSE 2 END";

export function captureBlocks(
  store: CaptureStore,
  captureId: number,
): BlockRef[] {
  return store
    .all(
      `SELECT section, category, hash, identity, bytes, inherited FROM capture_blocks
        WHERE capture_id = ? ORDER BY ${SECTION_ORDER}, position`,
      captureId,
    )
    .map((row) => {
      const parsed = BlockRowSchema.parse(row);
      return { ...parsed, inherited: parsed.inherited === 1 };
    });
}

function conversationIdentities(blocks: readonly BlockRef[]): string[] {
  return blocks
    .filter((block) => block.section === "messages")
    .map((block) => block.identity);
}

function commonPrefix(a: readonly string[], b: readonly string[]): number {
  let index = 0;
  while (index < a.length && index < b.length && a[index] === b[index]) {
    index += 1;
  }
  return index;
}

export type BlockDiff = {
  /** `section:position` of every block new relative to the previous request. */
  readonly newKeys: ReadonlySet<string>;
  readonly systemBytes: number;
  readonly toolsBytes: number;
  readonly historyBytes: number;
  readonly newBytes: number;
};

/**
 * What a request added over the previous one in its session: conversation
 * blocks past the shared prefix, and system or tool blocks the previous
 * request did not have. Identities ignore `cache_control`, which Claude Code
 * moves between requests without changing a block. Bytes are counted by
 * category, so Codex's `developer` messages count as system.
 */
export function diffBlocks(
  current: readonly BlockRef[],
  previous: readonly BlockRef[] | null,
): BlockDiff {
  const previousOther = new Set(
    (previous ?? [])
      .filter((block) => block.section !== "messages")
      .map((block) => `${block.section}:${block.identity}`),
  );
  const prefix = commonPrefix(
    conversationIdentities(current),
    conversationIdentities(previous ?? []),
  );
  const newKeys = new Set<string>();
  const bytes = { system: 0, tools: 0, history: 0, new: 0 };
  const positions = new Map<BlockSection, number>();
  for (const block of current) {
    const position = positions.get(block.section) ?? 0;
    positions.set(block.section, position + 1);
    const key = `${block.section}:${String(position)}`;
    const shared =
      block.section === "messages"
        ? position < prefix
        : previousOther.has(`${block.section}:${block.identity}`);
    if (!shared) newKeys.add(key);
    if (block.category === "conversation") {
      bytes[shared ? "history" : "new"] += block.bytes;
    } else {
      bytes[block.category] += block.bytes;
    }
  }
  return {
    newKeys,
    systemBytes: bytes.system,
    toolsBytes: bytes.tools,
    historyBytes: bytes.history,
    newBytes: bytes.new,
  };
}

const IdRowSchema = z.object({ id: z.number() });

/**
 * The request this one continues: the most recent capture in the same session
 * (or connection) sharing the longest conversation prefix. Subagents and side
 * calls share a session id with the main loop but not its prefix, so they
 * never diff against it. A chained request's parent shares its whole prefix,
 * so it wins. Warm-ups (Codex's `generate: false`) are never candidates: a
 * request chained from one diffs against the last real turn, or nothing.
 */
export function choosePrevious(
  store: CaptureStore,
  capture: {
    readonly id: number;
    readonly sessionKey: string | null;
    readonly connectionId: string;
    readonly startedAt: string;
  },
  blocks: readonly BlockRef[],
): number | null {
  const column = capture.sessionKey === null ? "connection_id" : "session_key";
  const candidates = store
    .all(
      `SELECT id FROM captures WHERE ${column} = ? AND id != ? AND started_at <= ? AND warmup = 0
        ORDER BY started_at DESC, id DESC LIMIT ${String(PREVIOUS_CANDIDATES)}`,
      capture.sessionKey ?? capture.connectionId,
      capture.id,
      capture.startedAt,
    )
    .map((row) => IdRowSchema.parse(row).id);
  const messages = conversationIdentities(blocks);
  let best: { id: number; prefix: number } | null = null;
  for (const id of candidates) {
    const prefix = commonPrefix(
      messages,
      conversationIdentities(captureBlocks(store, id)),
    );
    if (prefix > (best?.prefix ?? 0)) best = { id, prefix };
  }
  return best?.id ?? null;
}
