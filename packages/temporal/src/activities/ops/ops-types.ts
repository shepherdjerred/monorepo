import type { ServiceIndex } from "@shepherdjerred/ops-model/catalog.ts";
import type { Severity } from "@shepherdjerred/ops-model/severity.ts";
import type {
  ChangeEventInput,
  Metric,
  SectionId,
  SignalInput,
  SourceId,
  SourceStatus,
} from "@shepherdjerred/ops-model/snapshot.ts";

/** A headline metric tagged with the section that renders it. */
export type SectionMetric = Metric & { section: SectionId };

/** What one source contributes to a snapshot. */
export type OpsCollection = {
  signals: SignalInput[];
  metrics: SectionMetric[];
  changes: ChangeEventInput[];
};

/** Result of one source's collection activity. */
export type OpsSourceResult = OpsCollection & { status: SourceStatus };

/** Pure inputs every mapper shares. */
export type OpsContext = {
  now: Date;
  services: ServiceIndex;
};

export function emptyCollection(): OpsCollection {
  return { signals: [], metrics: [], changes: [] };
}

export function metric(input: {
  section: SectionId;
  source: SourceId;
  id: string;
  label: string;
  value: number | null;
  unit: Metric["unit"];
  severity?: Severity;
}): SectionMetric {
  return {
    section: input.section,
    source: input.source,
    id: input.id,
    label: input.label,
    value: input.value,
    unit: input.unit,
    severity: input.severity ?? "ok",
  };
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export function minutesSince(iso: string, now: Date): number {
  return (now.getTime() - Date.parse(iso)) / MINUTE_MS;
}

export function hoursSince(iso: string, now: Date): number {
  return (now.getTime() - Date.parse(iso)) / HOUR_MS;
}

export function daysSince(iso: string, now: Date): number {
  return (now.getTime() - Date.parse(iso)) / DAY_MS;
}

/** A Date `days` before `now`. */
export function daysBefore(now: Date, days: number): Date {
  return new Date(now.getTime() - days * DAY_MS);
}

export function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/** Service id for a Kubernetes namespace, when the catalog claims it. */
export function serviceForNamespace(
  context: OpsContext,
  namespace: string | undefined,
): { service?: string } {
  if (namespace === undefined) {
    return {};
  }
  const service = context.services.byNamespace(namespace);
  return service === undefined ? {} : { service: service.id };
}
