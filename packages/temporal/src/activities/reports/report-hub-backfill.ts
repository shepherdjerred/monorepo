import { ListObjectsV2Command } from "@aws-sdk/client-s3";
import { reportMailboxForType } from "@shepherdjerred/ops-model/email/mailbox.ts";
import type { ReportRunIngestItem } from "@shepherdjerred/ops-model/reports/report-ingest.ts";
import { z } from "zod/v4";
import { log } from "#observability/log.ts";
import { reportHubIngestTotal } from "#observability/metrics-report.ts";
import {
  ReportEnvelopeV1Schema,
  type ReportEnvelopeV1,
} from "#shared/reports/report.ts";
import {
  ReportDeliveryReceiptV1Schema,
  reportReceiptKey,
  reportStateKey,
  ReportStateV1Schema,
  type ReportDeliveryReceiptV1,
  type ReportStateV1,
} from "./report-delivery.ts";
import {
  buildHubReportIngestItem,
  pushReportRunsToHub,
  resolveHubIngestConfig,
  type HubReportIngestDependencies,
} from "./report-hub-ingest.ts";
import {
  notificationSkipKey,
  SkippedNotificationSchema,
  type SkippedNotification,
} from "./report-notification-policy.ts";
import {
  conditionalWrite,
  readJson,
  reportReceiptStore,
  writeJson,
  type ReportReceiptStore,
} from "./report-object-store.ts";

export const HUB_BACKFILL_CHECKPOINT_KEY = "reports/hub-backfill-v1.json";
export const HUB_BACKFILL_MAX_OBJECTS_PER_RUN = 40;

const PrefixCursorSchema = z.object({
  complete: z.boolean(),
  afterKey: z.string().min(1).optional(),
});

export const HubBackfillCheckpointV1Schema = z.object({
  schemaVersion: z.literal(1),
  state: PrefixCursorSchema,
  observations: PrefixCursorSchema,
  updatedAt: z.iso.datetime({ offset: true }),
});

export type HubBackfillCheckpointV1 = z.infer<
  typeof HubBackfillCheckpointV1Schema
>;

export type HubBackfillStorage = {
  receiptPrefix: string;
  statePrefix: string;
  observationsPrefix: string;
  listKeys: (input: {
    prefix: string;
    maxKeys: number;
    afterKey?: string | undefined;
  }) => Promise<{ keys: string[]; truncated: boolean }>;
  readState: (key: string) => Promise<ReportStateV1 | undefined>;
  readReceipt: (key: string) => Promise<ReportDeliveryReceiptV1 | undefined>;
  readObservation: (key: string) => Promise<ReportEnvelopeV1 | undefined>;
  readSkip: (key: string) => Promise<SkippedNotification | undefined>;
  readCheckpoint: () => Promise<
    { value: HubBackfillCheckpointV1; etag: string } | undefined
  >;
  writeCheckpoint: (
    checkpoint: HubBackfillCheckpointV1,
    expectedEtag: string | undefined,
  ) => Promise<boolean>;
};

function ensureTrailingSlash(prefix: string): string {
  return prefix.endsWith("/") ? prefix : `${prefix}/`;
}

export function createS3HubBackfillStorage(
  store: ReportReceiptStore,
): HubBackfillStorage {
  const statePrefix = ensureTrailingSlash(
    Bun.env["REPORT_STATE_PREFIX"] ?? "reports/state",
  );
  return {
    receiptPrefix: store.prefix,
    statePrefix,
    observationsPrefix: "reports/observations/prod/",
    listKeys: async ({ prefix, maxKeys, afterKey }) => {
      const page = await store.client.send(
        new ListObjectsV2Command({
          Bucket: store.bucket,
          Prefix: prefix,
          MaxKeys: maxKeys,
          ...(afterKey === undefined ? {} : { StartAfter: afterKey }),
        }),
      );
      const keys = (page.Contents ?? []).flatMap((object) =>
        object.Key?.startsWith(prefix) === true ? [object.Key] : [],
      );
      if (page.IsTruncated === true && keys.length === 0) {
        throw new Error(`Truncated Hub backfill listing is empty: ${prefix}`);
      }
      return { keys, truncated: page.IsTruncated === true };
    },
    readState: async (key) => {
      const stored = await readJson(store, key, ReportStateV1Schema);
      return stored?.value;
    },
    readReceipt: async (key) => {
      const stored = await readJson(store, key, ReportDeliveryReceiptV1Schema);
      return stored?.value;
    },
    readObservation: async (key) => {
      const stored = await readJson(store, key, ReportEnvelopeV1Schema);
      return stored?.value;
    },
    readSkip: async (key) => {
      const stored = await readJson(store, key, SkippedNotificationSchema);
      return stored?.value;
    },
    readCheckpoint: () =>
      readJson(
        store,
        HUB_BACKFILL_CHECKPOINT_KEY,
        HubBackfillCheckpointV1Schema,
      ),
    writeCheckpoint: (checkpoint, expectedEtag) =>
      conditionalWrite(() =>
        writeJson(
          store,
          HUB_BACKFILL_CHECKPOINT_KEY,
          HubBackfillCheckpointV1Schema.parse(checkpoint),
          { expectedEtag },
        ),
      ),
  };
}

function isStateObjectKey(key: string, statePrefix: string): boolean {
  const normalizedPrefix = ensureTrailingSlash(statePrefix);
  if (!key.startsWith(normalizedPrefix)) return false;
  const relative = key.slice(normalizedPrefix.length);
  const segments = relative.split("/");
  return (
    segments.length === 3 &&
    segments.every((segment) => segment.length > 0) &&
    relative.endsWith(".json") &&
    !relative.endsWith(".send-claim.json") &&
    !relative.endsWith(".latest-index.json")
  );
}

function isObservationObjectKey(key: string): boolean {
  return key.endsWith(".json") && !key.endsWith(".latest-index.json");
}

function advanceCursor(
  previous: HubBackfillCheckpointV1["state"],
  keys: readonly string[],
  truncated: boolean,
): HubBackfillCheckpointV1["state"] {
  const lastKey = keys.at(-1) ?? previous.afterKey;
  return {
    complete: !truncated,
    ...(lastKey === undefined ? {} : { afterKey: lastKey }),
  };
}

function sentIngestItem(
  report: ReportEnvelopeV1,
  receipt: Pick<ReportDeliveryReceiptV1, "messageId" | "acceptedAt">,
): ReportRunIngestItem {
  const mailbox = reportMailboxForType(report.reportType);
  return buildHubReportIngestItem({
    report,
    addresses: { sender: mailbox.from, recipient: mailbox.to },
    delivery: {
      deliveryStatus: "sent",
      messageId: receipt.messageId,
      acceptedAt: receipt.acceptedAt,
    },
  });
}

async function reconstructFromStateKey(
  storage: HubBackfillStorage,
  key: string,
): Promise<ReportRunIngestItem | undefined> {
  if (!isStateObjectKey(key, storage.statePrefix)) return undefined;
  const state = await storage.readState(key);
  if (state === undefined) return undefined;
  const receipt =
    state.delivery.status === "accepted"
      ? state.delivery.receipt
      : await storage.readReceipt(
          reportReceiptKey(state.report, storage.receiptPrefix),
        );
  return receipt === undefined
    ? undefined
    : sentIngestItem(state.report, receipt);
}

async function reconstructFromObservationKey(
  storage: HubBackfillStorage,
  key: string,
): Promise<ReportRunIngestItem | undefined> {
  if (!isObservationObjectKey(key)) return undefined;
  const observation = await storage.readObservation(key);
  if (observation === undefined) return undefined;

  const receipt = await storage.readReceipt(
    reportReceiptKey(observation, storage.receiptPrefix),
  );
  if (receipt !== undefined) {
    return sentIngestItem(observation, receipt);
  }

  const state = await storage.readState(
    reportStateKey(observation, storage.statePrefix.replace(/\/+$/u, "")),
  );
  if (state?.delivery.status === "accepted") {
    return sentIngestItem(observation, state.delivery.receipt);
  }

  if (observation.scheduleId === undefined || observation.scheduleId === "") {
    return undefined;
  }
  const skip = await storage.readSkip(notificationSkipKey(observation, "prod"));
  if (skip === undefined) return undefined;

  const mailbox = reportMailboxForType(observation.reportType);
  return buildHubReportIngestItem({
    report: observation,
    addresses: { sender: mailbox.from, recipient: mailbox.to },
    delivery: {
      deliveryStatus: "skipped",
      skipReason: skip.reason,
    },
  });
}

async function listBoundedBackfillKeys(
  storage: HubBackfillStorage,
  current: HubBackfillCheckpointV1,
  maxObjects: number,
): Promise<{
  stateKeys: string[];
  observationKeys: string[];
  nextState: HubBackfillCheckpointV1["state"];
  nextObservations: HubBackfillCheckpointV1["observations"];
}> {
  let remaining = maxObjects;
  let stateKeys: string[] = [];
  let nextState = current.state;

  if (!current.state.complete && remaining > 0) {
    const page = await storage.listKeys({
      prefix: storage.statePrefix,
      maxKeys: remaining,
      afterKey: current.state.afterKey,
    });
    stateKeys = page.keys;
    remaining -= page.keys.length;
    nextState = advanceCursor(current.state, page.keys, page.truncated);
  }

  let observationKeys: string[] = [];
  let nextObservations = current.observations;

  if (!current.observations.complete && remaining > 0) {
    const page = await storage.listKeys({
      prefix: storage.observationsPrefix,
      maxKeys: remaining,
      afterKey: current.observations.afterKey,
    });
    observationKeys = page.keys;
    nextObservations = advanceCursor(
      current.observations,
      page.keys,
      page.truncated,
    );
  }

  return { stateKeys, observationKeys, nextState, nextObservations };
}

async function collectBackfillItems(
  storage: HubBackfillStorage,
  stateKeys: readonly string[],
  observationKeys: readonly string[],
): Promise<ReportRunIngestItem[]> {
  const itemsByRunId = new Map<string, ReportRunIngestItem>();
  for (const key of stateKeys) {
    const item = await reconstructFromStateKey(storage, key);
    if (item !== undefined) {
      itemsByRunId.set(item.report.reportRunId, item);
    }
  }
  for (const key of observationKeys) {
    const item = await reconstructFromObservationKey(storage, key);
    if (item !== undefined && !itemsByRunId.has(item.report.reportRunId)) {
      itemsByRunId.set(item.report.reportRunId, item);
    }
  }
  return [...itemsByRunId.values()];
}

export async function runHubReportBackfillPage(input: {
  storage: HubBackfillStorage;
  ingestDeps?: HubReportIngestDependencies;
  now?: () => string;
  maxObjects?: number;
}): Promise<{
  scanned: number;
  pushed: number;
  complete: boolean;
}> {
  const ingestDeps = input.ingestDeps ?? {};
  if (resolveHubIngestConfig(ingestDeps.env ?? Bun.env) === undefined) {
    return { scanned: 0, pushed: 0, complete: false };
  }

  const now = input.now ?? (() => new Date().toISOString());
  const maxObjects = input.maxObjects ?? HUB_BACKFILL_MAX_OBJECTS_PER_RUN;
  const stored = await input.storage.readCheckpoint();
  const current: HubBackfillCheckpointV1 = stored?.value ?? {
    schemaVersion: 1,
    state: { complete: false },
    observations: { complete: false },
    updatedAt: now(),
  };

  if (current.state.complete && current.observations.complete) {
    return { scanned: 0, pushed: 0, complete: true };
  }

  const { stateKeys, observationKeys, nextState, nextObservations } =
    await listBoundedBackfillKeys(input.storage, current, maxObjects);
  const items = await collectBackfillItems(
    input.storage,
    stateKeys,
    observationKeys,
  );
  const { pushed } = await pushReportRunsToHub(items, ingestDeps);

  await input.storage.writeCheckpoint(
    {
      schemaVersion: 1,
      state: nextState,
      observations: nextObservations,
      updatedAt: now(),
    },
    stored?.etag,
  );

  return {
    scanned: stateKeys.length + observationKeys.length,
    pushed,
    complete: nextState.complete && nextObservations.complete,
  };
}

export async function runHubReportBackfillSafely(
  store?: ReportReceiptStore,
  options: {
    storage?: HubBackfillStorage;
    ingestDeps?: HubReportIngestDependencies;
    now?: () => string;
    maxObjects?: number;
  } = {},
): Promise<{
  scanned: number;
  pushed: number;
  complete: boolean;
}> {
  const ingestDeps = options.ingestDeps ?? {};
  if (resolveHubIngestConfig(ingestDeps.env ?? Bun.env) === undefined) {
    return { scanned: 0, pushed: 0, complete: false };
  }
  try {
    const resolvedStorage =
      options.storage ??
      createS3HubBackfillStorage(store ?? reportReceiptStore());
    return await runHubReportBackfillPage({
      storage: resolvedStorage,
      ingestDeps,
      ...(options.now === undefined ? {} : { now: options.now }),
      ...(options.maxObjects === undefined
        ? {}
        : { maxObjects: options.maxObjects }),
    });
  } catch (error: unknown) {
    reportHubIngestTotal.inc({ outcome: "failed" });
    log("warning", "Hub historical report backfill step failed", {
      module: "report-hub-backfill",
      error,
    });
    return { scanned: 0, pushed: 0, complete: false };
  }
}
