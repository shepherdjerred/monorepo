import { Counter, Gauge } from "prom-client";
import { register } from "./metrics.ts";

// ---------------------------------------------------------------------------
// Glitter Discord corpus
// ---------------------------------------------------------------------------
// Split out of metrics.ts (which sits at the repo's max-lines cap), the same
// sibling-file pattern as ./pr-review-metrics.ts. Import from
// #observability/metrics-glitter.ts directly, not from metrics.ts.

export const glitterCorpusDiscordRequestsTotal = new Counter({
  name: "glitter_corpus_discord_requests_total",
  help: "Discord REST requests made by the corpus archiver, by outcome",
  labelNames: ["outcome"] as const,
  registers: [register],
});

export const glitterCorpusPagesTotal = new Counter({
  name: "glitter_corpus_pages_total",
  help: "Immutable Discord response pages stored by traversal direction",
  labelNames: ["direction"] as const,
  registers: [register],
});

export const glitterCorpusMessagesObservedTotal = new Counter({
  name: "glitter_corpus_messages_observed_total",
  help: "Message observations captured from Discord REST by traversal direction",
  labelNames: ["direction"] as const,
  registers: [register],
});

export const glitterCorpusInventoryEntries = new Gauge({
  name: "glitter_corpus_inventory_entries",
  help: "Latest discovered Discord channel/thread inventory by scope decision",
  labelNames: ["decision"] as const,
  registers: [register],
});

export const glitterCorpusInventoryScopeChanges = new Gauge({
  name: "glitter_corpus_inventory_scope_changes",
  help: "Channel and thread scope changes between the latest Discord inventory and the published baseline",
  labelNames: ["change"] as const,
  registers: [register],
});

export const glitterCorpusSnapshotMessages = new Gauge({
  name: "glitter_corpus_snapshot_messages",
  help: "Unique messages in the most recently published complete guild snapshot",
  registers: [register],
});

export const glitterCorpusLastSnapshotTimestampSeconds = new Gauge({
  name: "glitter_corpus_last_snapshot_timestamp_seconds",
  help: "Unix timestamp of the most recently published complete guild snapshot",
  registers: [register],
});

export const glitterCorpusSnapshotMetricsConfigured = new Gauge({
  name: "glitter_corpus_snapshot_metrics_configured",
  help: "1 when the worker has enough storage configuration to restore Glitter corpus snapshot metrics after restart",
  registers: [register],
});

export const glitterCorpusStorageIntegrityFailuresTotal = new Counter({
  name: "glitter_corpus_storage_integrity_failures_total",
  help: "Missing, collided, or checksum-invalid Glitter corpus objects in SeaweedFS",
  registers: [register],
});

export const glitterContextRefreshRunsTotal = new Counter({
  name: "glitter_context_refresh_runs_total",
  help: "Weekly verified Glitter context refresh runs by outcome",
  labelNames: ["outcome"] as const,
  registers: [register],
});

export const glitterContextRefreshPeople = new Gauge({
  name: "glitter_context_refresh_people",
  help: "People eligible for or refreshed by the latest Glitter context run",
  labelNames: ["state"] as const,
  registers: [register],
});

export const glitterContextRefreshRelationshipProposals = new Gauge({
  name: "glitter_context_refresh_relationship_proposals",
  help: "Evidence-backed relationship updates in the latest Glitter context run",
  registers: [register],
});
