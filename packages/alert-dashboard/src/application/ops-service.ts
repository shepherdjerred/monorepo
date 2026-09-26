import {
  allSignals,
  applyFreshness,
  newSignals,
  type FreshSnapshot,
} from "@shepherdjerred/ops-model/assemble.ts";
import type { ServiceIndex } from "@shepherdjerred/ops-model/catalog.ts";
import { OPS_POLICY } from "@shepherdjerred/ops-model/policy.ts";
import {
  parseOpsIngest,
  SnapshotResponseSchema,
  type SnapshotResponse,
} from "@shepherdjerred/ops-model/snapshot.ts";
import { Temporal } from "@js-temporal/polyfill";

import type {
  OpsRepository,
  SeriesPort,
  StoreOpsSnapshotResult,
  StoredOpsSnapshot,
} from "#application/ports";
import {
  ServiceNotFoundError,
  SnapshotUnavailableError,
} from "#application/ops-errors";
import { alertChangeView, mergeChanges } from "#domain/ops-changes";
import { serviceLinks, type GrafanaDatasourceUids } from "#domain/ops-links";
import { planSeries, SERIES_PRESETS } from "#domain/ops-series";
import {
  ChangeListInputSchema,
  CursorInputSchema,
  CursorResponseSchema,
  SeriesInputSchema,
  SeriesResponseSchema,
  ServiceDetailSchema,
  type ChangeListInput,
  type ChangeView,
  type CursorConsumer,
  type CursorResponse,
  type SeriesInput,
  type SeriesResponse,
  type ServiceDetail,
} from "#shared/ops-schema";
import { JsonTextSchema } from "#shared/json-text";
import {
  epochNanosecondsToInstantText,
  toContractDate,
  type Clock,
} from "#shared/time";

const SERVICE_DETAIL_CHANGE_LIMIT = 50;

export type OpsServiceOptions = {
  repository: OpsRepository;
  series: SeriesPort;
  clock: Clock;
  services: ServiceIndex;
  grafanaUids: GrafanaDatasourceUids;
};

export class OpsService {
  readonly #repository: OpsRepository;
  readonly #series: SeriesPort;
  readonly #clock: Clock;
  readonly #services: ServiceIndex;
  readonly #grafanaUids: GrafanaDatasourceUids;

  constructor(options: OpsServiceOptions) {
    this.#repository = options.repository;
    this.#series = options.series;
    this.#clock = options.clock;
    this.#services = options.services;
    this.#grafanaUids = options.grafanaUids;
  }

  /** Validate and store one collector delivery; prunes old snapshots. */
  async ingest(rawBody: string): Promise<StoreOpsSnapshotResult> {
    const body = parseOpsIngest(JsonTextSchema.parse(rawBody));
    return this.#repository.storeSnapshot({
      snapshot: body.snapshot,
      generatedAtNs: instantNs(body.snapshot.generatedAt),
      receivedAtNs: this.#clock.now().epochNanoseconds,
      changes: body.changes.map((change) => ({
        ...change,
        occurredAtNs: instantNs(change.occurredAt),
      })),
      retentionDays: OPS_POLICY.snapshotHistoryDays,
    });
  }

  /** The newest stored snapshot with freshness applied now. */
  async freshSnapshot(): Promise<{
    stored: StoredOpsSnapshot;
    fresh: FreshSnapshot;
  } | null> {
    const stored = await this.#repository.latestSnapshot();
    if (stored === null) return null;
    return {
      stored,
      fresh: applyFreshness(stored.snapshot, toContractDate(this.#clock.now())),
    };
  }

  async snapshot(consumer?: CursorConsumer): Promise<SnapshotResponse> {
    const latest = await this.freshSnapshot();
    if (latest === null) throw new SnapshotUnavailableError();
    let newSignalIds: string[] = [];
    if (consumer !== undefined) {
      const cursor = await this.#repository.getCursor(consumer);
      const seen = new Set(cursor?.seenSignalIds);
      newSignalIds = newSignals(latest.fresh, seen).map((signal) => signal.id);
    }
    return SnapshotResponseSchema.parse({
      ...latest.fresh,
      receivedAt: epochNanosecondsToInstantText(latest.stored.receivedAtNs),
      newSignalIds,
    });
  }

  /** Last successful ingest, for the `/metrics` freshness gauge. */
  async lastIngestAtNs(): Promise<bigint | null> {
    const stored = await this.#repository.latestSnapshot();
    return stored?.receivedAtNs ?? null;
  }

  async changes(input: ChangeListInput): Promise<ChangeView[]> {
    const parsed = ChangeListInputSchema.parse(input);
    const service =
      parsed.service === undefined ? undefined : this.#service(parsed.service);
    const sinceNs =
      parsed.since === undefined ? undefined : instantNs(parsed.since);
    return this.changesBetween({
      ...(service === undefined
        ? {}
        : { service: service.id, namespaces: service.namespaces }),
      ...(sinceNs === undefined ? {} : { sinceNs }),
      limit: parsed.limit,
    });
  }

  /** Stored change events merged with alert openings and resolutions. */
  async changesBetween(query: {
    service?: string;
    namespaces?: readonly string[];
    sinceNs?: bigint;
    untilNs?: bigint;
    limit: number;
  }): Promise<ChangeView[]> {
    const { namespaces, ...storedQuery } = query;
    const [stored, alerts] = await Promise.all([
      this.#repository.listChanges(storedQuery),
      namespaces?.length === 0
        ? Promise.resolve([])
        : this.#repository.alertChanges({
            ...(namespaces === undefined ? {} : { namespaces }),
            ...(query.sinceNs === undefined ? {} : { sinceNs: query.sinceNs }),
            ...(query.untilNs === undefined ? {} : { untilNs: query.untilNs }),
            limit: query.limit,
          }),
    ]);
    return mergeChanges(
      [stored, alerts.map((change) => alertChangeView(change, this.#services))],
      query.limit,
    );
  }

  async serviceDetail(id: string): Promise<ServiceDetail> {
    const service = this.#service(id);
    const [stored, changes] = await Promise.all([
      this.#repository.latestSnapshot(),
      this.changesBetween({
        service: service.id,
        namespaces: service.namespaces,
        limit: SERVICE_DETAIL_CHANGE_LIMIT,
      }),
    ]);
    return ServiceDetailSchema.parse({
      service,
      snapshotGeneratedAt:
        stored === null
          ? null
          : epochNanosecondsToInstantText(stored.generatedAtNs),
      signals:
        stored === null
          ? []
          : allSignals(stored.snapshot).filter(
              (signal) => signal.service === service.id,
            ),
      changes,
      links: serviceLinks(service, this.#grafanaUids),
    });
  }

  async series(input: SeriesInput): Promise<SeriesResponse> {
    const parsed = SeriesInputSchema.parse(input);
    const preset = SERIES_PRESETS[parsed.preset];
    const nowSeconds = Math.floor(this.#clock.now().epochMilliseconds / 1000);
    const planned = planSeries(parsed.preset, parsed.range, nowSeconds);
    const results = await Promise.all(
      planned.map(async (query) => {
        const series = await this.#series.range(query);
        return series.map((entry) => ({
          name:
            query.legendLabel === undefined
              ? query.name
              : (entry.metric[query.legendLabel] ?? query.name),
          points: entry.points,
        }));
      }),
    );
    const first = planned[0];
    if (first === undefined)
      throw new Error(`Series preset ${parsed.preset} has no queries`);
    return SeriesResponseSchema.parse({
      preset: parsed.preset,
      range: parsed.range,
      title: preset.title,
      unit: preset.unit,
      stepSeconds: first.stepSeconds,
      start: first.startSeconds,
      end: first.endSeconds,
      series: results
        .flat()
        .toSorted((left, right) => left.name.localeCompare(right.name)),
    });
  }

  async putCursor(input: unknown): Promise<CursorResponse> {
    const parsed = CursorInputSchema.parse(input);
    const now = this.#clock.now();
    const seenSignalIds = [...new Set(parsed.seenSignalIds)];
    await this.#repository.putCursor({
      consumer: parsed.consumer,
      lastSeenAtNs: now.epochNanoseconds,
      seenSignalIds,
    });
    return CursorResponseSchema.parse({
      consumer: parsed.consumer,
      lastSeenAt: now.toString(),
      seenCount: seenSignalIds.length,
    });
  }

  #service(id: string) {
    const service = this.#services.byId(id);
    if (service === undefined) throw new ServiceNotFoundError(id);
    return service;
  }
}

function instantNs(value: string): bigint {
  return Temporal.Instant.from(value).epochNanoseconds;
}
