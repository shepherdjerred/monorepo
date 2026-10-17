import {
  MigrationSnapshotSchema,
  type MigrationRecord,
  type MigrationSnapshot,
} from "#shared/migration.ts";
import {
  ENDPOINT_KINDS,
  recordDigest,
  validateCapture,
} from "./capture-validation.ts";
import { CaptureReadError } from "./capture-http.ts";

export type CapturePass = {
  records: MigrationRecord[];
  version: string;
  pages: number;
  reason: "complete" | "page_limit" | "record_limit" | "read_failed";
};
export function failureReason(error: unknown): CapturePass["reason"] {
  return error instanceof CaptureReadError ? error.reason : "read_failed";
}
export function finishCapture(input: {
  sourceKind: MigrationSnapshot["sourceKind"];
  sourceInstanceId: string;
  startedAt: string;
  endpoints: (keyof typeof ENDPOINT_KINDS)[];
  first: CapturePass;
  second: CapturePass;
}) {
  const { first, second } = input;
  const complete = first.reason === "complete" && second.reason === "complete";
  const stable =
    complete &&
    first.version === second.version &&
    recordDigest(first.records) === recordDigest(second.records);
  const reason = complete
    ? stable
      ? "complete"
      : "source_changed"
    : first.reason === "complete"
      ? second.reason
      : first.reason;
  return validateCapture(
    MigrationSnapshotSchema.parse({
      schemaVersion: 1,
      sourceKind: input.sourceKind,
      sourceInstanceId: input.sourceInstanceId,
      sourceVersion: second.version,
      startedAt: input.startedAt,
      completedAt: new Date().toISOString(),
      records: second.records,
      endpoints: input.endpoints.map((name, index) => {
        const records = second.records.filter(
          (record) => record.kind === ENDPOINT_KINDS[name],
        );
        return {
          name,
          pages: index === 0 ? first.pages + second.pages : 0,
          records: records.length,
          digest: recordDigest(records),
          complete: stable,
          stable,
          reason,
        };
      }),
    }),
  ).snapshot;
}
