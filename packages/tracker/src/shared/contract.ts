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

export type AppRouter = ServerRouter & { readonly __wireContract?: never };
export type ActorEnvelope = z.infer<typeof Actor>;
export const ActorSchema = Actor.clone();
export const ActorMetadataSchema = Metadata.clone();
export const StateTypeSchema = StateType.clone();
export const IdentifierSchema = Identifier.clone();
export const CreateIssueSchema = CreateIssue.clone();
export const UpdateIssueSchema = UpdateIssue.clone();
export const IssueListSchema = IssueList.clone();
