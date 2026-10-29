import { z } from "zod";
import {
  PrepareHandoffSchema,
  ApplyHandoffSchema,
  HandoffScopeSchema,
  HandoffNetworkEvidenceSchema,
} from "#shared/handoff.ts";
import {
  PrepareLibraryHandoffV2Schema,
  ApplyLibraryHandoffV2Schema,
  LibraryHandoffScopeV2Schema,
  HandoffNetworkV2Schema,
  FinishedLibraryHandoffV2Schema,
  LibraryHandoffSelectionV2Schema,
} from "#shared/handoff-v2.ts";
import {
  PrepareLibraryHandoffV3Schema,
  ApplyLibraryHandoffV3Schema,
  LibraryHandoffScopeV3Schema,
  HandoffNetworkV3Schema,
  FinishedLibraryHandoffV3Schema,
  LibraryHandoffSelectionV3Schema,
} from "./library-v3.ts";
import type { MovieEditionKey } from "#shared/movie-editions/registry.ts";

/** Dispatch versions explicitly; no historical body is normalized into a new authority. */
export const PrepareLibraryHandoffProtocolSchema = z.union([
  PrepareLibraryHandoffV2Schema,
  PrepareLibraryHandoffV3Schema,
]);
export const LibraryHandoffScopeProtocolSchema = z.union([
  LibraryHandoffScopeV2Schema,
  LibraryHandoffScopeV3Schema,
]);
export const LibraryHandoffNetworkProtocolSchema = z.union([
  HandoffNetworkV2Schema,
  HandoffNetworkV3Schema,
]);
export const PrepareHandoffProtocolSchema = z.union([
  PrepareHandoffSchema,
  PrepareLibraryHandoffV2Schema,
  PrepareLibraryHandoffV3Schema,
]);
export const ApplyHandoffProtocolSchema = z.union([
  ApplyHandoffSchema,
  ApplyLibraryHandoffV2Schema,
  ApplyLibraryHandoffV3Schema,
]);
export const HandoffScopeProtocolSchema = z.union([
  HandoffScopeSchema,
  LibraryHandoffScopeV2Schema,
  LibraryHandoffScopeV3Schema,
]);
export const HandoffNetworkProtocolSchema = z.union([
  HandoffNetworkEvidenceSchema,
  HandoffNetworkV2Schema,
  HandoffNetworkV3Schema,
]);
export const FinishedLibraryHandoffProtocolSchema = z.union([
  FinishedLibraryHandoffV2Schema,
  FinishedLibraryHandoffV3Schema,
]);
export const LibraryHandoffSelectionProtocolSchema = z.union([
  LibraryHandoffSelectionV2Schema,
  LibraryHandoffSelectionV3Schema,
]);
export type HandoffProtocolScope = z.infer<typeof HandoffScopeProtocolSchema>;
export type LibraryHandoffScope = z.infer<
  typeof LibraryHandoffScopeProtocolSchema
>;

export function handoffProtocolVersion(scope: HandoffProtocolScope): 1 | 2 | 3 {
  return "schemaVersion" in scope ? scope.schemaVersion : 1;
}
export function assertHandoffNetworkProtocol(
  scope: HandoffProtocolScope,
  network: { schemaVersion: 1 | 2 | 3 },
): void {
  if (network.schemaVersion !== handoffProtocolVersion(scope))
    throw new Error("Handoff file and network protocols differ");
}
export function handoffFileEdition(
  file: HandoffProtocolScope["files"][number],
): MovieEditionKey {
  return "edition" in file ? file.edition : "default";
}
