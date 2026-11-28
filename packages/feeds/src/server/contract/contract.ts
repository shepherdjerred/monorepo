/**
 * The Feeds store's behaviour. `postgres/store.integration.test.ts` runs it
 * against PostgreSQL.
 */
import {
  searchesAndMarksRead,
  protectsCodeFeeds,
  servesReaderSessionsAndStreams,
  allocatesIdsNewestFirst,
} from "./entries.ts";
import {
  reconcilesCatalog,
  appliesAutoReadOnInsert,
  autoReadsBackfilledCategories,
  schedulesPolls,
} from "./feeds.ts";
import type { OpenStore } from "./support.ts";

export const FEEDS_STORE_CONTRACT: readonly {
  readonly name: string;
  readonly run: (open: OpenStore) => Promise<void>;
}[] = [
  {
    name: "reconciles full catalog idempotently, preserves user feeds, and prunes stale code feeds",
    run: reconcilesCatalog,
  },
  {
    name: "applies auto-read on insert without overwriting manual unread/star state on re-poll",
    run: appliesAutoReadOnInsert,
  },
  {
    name: "auto-reads existing unstarred unread entries when a poll backfills matching categories without overriding manual unread",
    run: autoReadsBackfilledCategories,
  },
  {
    name: "handles poll scheduling, backoff filtering, 304 not-modified, and health redaction",
    run: schedulesPolls,
  },
  {
    name: "supports full-text search with tricky punctuation, hidden feed scoping, pagination, and markAllRead",
    run: searchesAndMarksRead,
  },
  {
    name: "enforces source='code' forbidden protection, user feed CRUD, and category mutations",
    run: protectsCodeFeeds,
  },
  {
    name: "supports Reader sessions, stream queries, and entry pruning",
    run: servesReaderSessionsAndStreams,
  },
  {
    name: "allocates IDs newest-first for descending RSS items and prevents pruned archive resurrection",
    run: allocatesIdsNewestFirst,
  },
];
