import type { AppRouter as ServerRouter } from "#server/router.ts";
import {
  ActorSchema as Actor,
  ActorMetadataSchema as Metadata,
} from "./actor.ts";
import {
  StateTypeSchema as StateType,
  IdentifierSchema as Identifier,
  CreateIssueSchema as CreateIssue,
  UpdateIssueSchema as UpdateIssue,
  IssueListSchema as IssueList,
} from "./schema.ts";
import type { z } from "zod";
import { ImportRecordSchema as ImportRecord } from "./import-schema.ts";
import { ImportAttachmentFileSchema as ImportAttachmentFile } from "./import-schema.ts";
import { ReconcileRecordSchema as ReconcileRecord } from "./import-schema.ts";
import { importId as destinationId } from "./import-identity.ts";

export type AppRouter = ServerRouter & { readonly __wireContract?: never };
export type ActorEnvelope = z.infer<typeof Actor>;
export const ActorSchema = Actor.clone();
export const ActorMetadataSchema = Metadata.clone();
export const StateTypeSchema = StateType.clone();
export const IdentifierSchema = Identifier.clone();
export const CreateIssueSchema = CreateIssue.clone();
export const UpdateIssueSchema = UpdateIssue.clone();
export const IssueListSchema = IssueList.clone();
export const ImportRecordSchema = ImportRecord.clone();
export const ImportAttachmentFileSchema = ImportAttachmentFile.clone();
export const ReconcileRecordSchema = ReconcileRecord.clone();
export const importId = (
  source: string,
  entityType: string,
  externalId: string,
) => destinationId(source, entityType, externalId);
