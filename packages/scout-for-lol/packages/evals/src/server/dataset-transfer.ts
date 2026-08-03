import { z } from "zod";

import {
  DatasetDraftTransferPayloadSchema,
  DatasetDraftTransferSchema,
  DatasetExportPayloadSchema,
  DatasetExportSchema,
  type DatasetDraftTransfer,
  type DatasetDraftTransferPayload,
  type DatasetExport,
  type DatasetExportPayload,
} from "#shared/schema.ts";

function compareJsonKeys(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function sortJsonValue(value: unknown): unknown {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number") {
    return z.number().parse(value);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => sortJsonValue(entry));
  }
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort(compareJsonKeys)
        .map((key) => [key, sortJsonValue(Reflect.get(value, key))]),
    );
  }
  throw new TypeError(`Cannot serialize JSON value of type ${typeof value}`);
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortJsonValue(value));
}

function payloadFromExport(datasetExport: DatasetExport): DatasetExportPayload {
  return DatasetExportPayloadSchema.parse({
    schemaVersion: datasetExport.schemaVersion,
    dataset: datasetExport.dataset,
    cases: datasetExport.cases,
    freshnessRatings: datasetExport.freshnessRatings,
  });
}

function payloadSha256(payload: unknown): string {
  return new Bun.CryptoHasher("sha256")
    .update(canonicalJson(payload))
    .digest("hex");
}

function requireValidChecksum(datasetExport: DatasetExport): void {
  const actual = payloadSha256(payloadFromExport(datasetExport));
  if (actual !== datasetExport.sha256) {
    throw new Error(
      `Dataset export checksum mismatch: expected ${datasetExport.sha256}, calculated ${actual}`,
    );
  }
}

export function createDatasetExport(
  payload: DatasetExportPayload,
): DatasetExport {
  const parsedPayload = DatasetExportPayloadSchema.parse(payload);
  return DatasetExportSchema.parse({
    ...parsedPayload,
    sha256: payloadSha256(parsedPayload),
  });
}

export function validateDatasetExport(value: unknown): DatasetExport {
  const datasetExport = DatasetExportSchema.parse(value);
  requireValidChecksum(datasetExport);
  return datasetExport;
}

export function parseDatasetExport(serialized: string): DatasetExport {
  let decoded: unknown;
  try {
    decoded = JSON.parse(serialized);
  } catch (error) {
    throw new Error("Dataset export is not valid JSON", { cause: error });
  }
  return validateDatasetExport(decoded);
}

export function serializeDatasetExport(value: unknown): string {
  const datasetExport = validateDatasetExport(value);
  return `${JSON.stringify(sortJsonValue(datasetExport), null, 2)}\n`;
}

function draftPayloadFromTransfer(
  transfer: DatasetDraftTransfer,
): DatasetDraftTransferPayload {
  return DatasetDraftTransferPayloadSchema.parse({
    schemaVersion: transfer.schemaVersion,
    dataset: transfer.dataset,
    cases: transfer.cases,
  });
}

export function createDraftTransfer(
  payload: DatasetDraftTransferPayload,
): DatasetDraftTransfer {
  const parsedPayload = DatasetDraftTransferPayloadSchema.parse(payload);
  return DatasetDraftTransferSchema.parse({
    ...parsedPayload,
    sha256: payloadSha256(parsedPayload),
  });
}

export function validateDraftTransfer(value: unknown): DatasetDraftTransfer {
  const transfer = DatasetDraftTransferSchema.parse(value);
  const actual = payloadSha256(draftPayloadFromTransfer(transfer));
  if (actual !== transfer.sha256) {
    throw new Error(
      `Draft transfer checksum mismatch: expected ${transfer.sha256}, calculated ${actual}`,
    );
  }
  return transfer;
}
