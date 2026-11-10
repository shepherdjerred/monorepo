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
  BulkUpdateIssuesSchema as BulkUpdateIssues,
  IssueListSchema as IssueList,
  DueDateSchema as DueDate,
  ViewParamsSchema as ViewParams,
  CreateViewSchema as CreateView,
  UpdateViewSchema as UpdateView,
} from "./schema.ts";
import type { CLIENT_REQUEST_ID_HEADER as ClientRequestIdHeader } from "./live-updates.ts";
import {
  LiveChangeSchema as LiveChange,
  LiveMessageSchema as LiveMessageUnion,
} from "./live-updates.ts";
import type { z } from "zod";

export type AppRouter = ServerRouter & { readonly __wireContract?: never };
export type ActorEnvelope = z.infer<typeof Actor>;
export const ActorSchema = Actor.clone();
export const ActorMetadataSchema = Metadata.clone();
export const StateTypeSchema = StateType.clone();
export const IdentifierSchema = Identifier.clone();
export const CreateIssueSchema = CreateIssue.clone();
export const UpdateIssueSchema = UpdateIssue.clone();
export const BulkUpdateIssuesSchema = BulkUpdateIssues.clone();
export const IssueListSchema = IssueList.clone();
export const DueDateSchema = DueDate.clone();
export const ViewParamsSchema = ViewParams.clone();
export const CreateViewSchema = CreateView.clone();
export const UpdateViewSchema = UpdateView.clone();
export type DueDate = z.infer<typeof DueDate>;
export type ViewParams = z.infer<typeof ViewParams>;
export const LiveChangeSchema = LiveChange.clone();
export const LiveMessageSchema = LiveMessageUnion.clone();
/** Its literal type makes the compiler hold it equal to the server's value. */
export const CLIENT_REQUEST_ID_HEADER: typeof ClientRequestIdHeader =
  "x-tracker-request-id";
export type LiveChange = z.infer<typeof LiveChange>;
export type LiveMessage = z.infer<typeof LiveMessageUnion>;
