import {
  IssueListItemSchema,
  ProjectSummarySchema,
} from "@shepherdjerred/errors/contract";
import { z } from "zod";

export const ProjectListResponseSchema = z.union([
  z.array(ProjectSummarySchema),
  z.object({ items: z.array(ProjectSummarySchema) }).transform((v) => v.items),
  z
    .object({ projects: z.array(ProjectSummarySchema) })
    .transform((v) => v.projects),
]);

export const ProjectResponseSchema = z.union([
  ProjectSummarySchema,
  z.object({ project: ProjectSummarySchema }).transform((v) => v.project),
]);

export const SingleIssueUpdateResponseSchema = z.union([
  IssueListItemSchema,
  z.object({ issue: IssueListItemSchema }).transform((v) => v.issue),
]);

export const StacktraceJsonResponseSchema = z.record(z.string(), z.unknown());
