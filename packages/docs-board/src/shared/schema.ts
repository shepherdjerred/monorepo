import { z } from "zod";

export const DOCUMENT_TYPES = [
  "architecture",
  "decision",
  "guide",
  "log",
  "pattern",
  "plan",
  "todo",
  "reference",
] as const;

export const DOCUMENT_STATUSES = [
  "planned",
  "in-progress",
  "awaiting-human",
  "complete",
] as const;

export const VERIFICATION_TYPES = ["agent", "human"] as const;
export const DISPOSITIONS = ["active", "blocked", "deferred"] as const;

export const DocumentIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]*$/);
export const DocumentTypeSchema = z.enum(DOCUMENT_TYPES);
export const DocumentStatusSchema = z.enum(DOCUMENT_STATUSES);
export const VerificationSchema = z.enum(VERIFICATION_TYPES);
export const DispositionSchema = z.enum(DISPOSITIONS);

export const FrontmatterSchema = z
  .looseObject({
    id: DocumentIdSchema,
    type: DocumentTypeSchema,
    status: DocumentStatusSchema,
    board: z.boolean(),
    verification: VerificationSchema.optional(),
    disposition: DispositionSchema.optional(),
    origin: z.string().min(1).optional(),
    source_marker: z.boolean().optional(),
  })
  .superRefine((value, context) => {
    if (!value.board) return;
    if (value.verification === undefined) {
      context.addIssue({
        code: "custom",
        path: ["verification"],
        message: "board documents require verification",
      });
    }
    if (value.disposition === undefined) {
      context.addIssue({
        code: "custom",
        path: ["disposition"],
        message: "board documents require disposition",
      });
    }
    if (value.status === "awaiting-human" && value.verification !== "human") {
      context.addIssue({
        code: "custom",
        path: ["verification"],
        message: "awaiting-human documents require human verification",
      });
    }
  });

export type DocumentFrontmatter = z.infer<typeof FrontmatterSchema>;
export type DocumentStatus = z.infer<typeof DocumentStatusSchema>;

export const RepositoryInfoSchema = z.object({
  root: z.string(),
  branch: z.string(),
  dirty: z.boolean(),
  actor: z.string(),
});

export const DocumentSummarySchema = z.object({
  id: DocumentIdSchema,
  path: z.string(),
  title: z.string(),
  type: DocumentTypeSchema,
  status: DocumentStatusSchema,
  board: z.boolean(),
  verification: VerificationSchema.nullable(),
  disposition: DispositionSchema.nullable(),
  remainingCount: z.number().int().nonnegative(),
  hasHumanVerification: z.boolean(),
  commentCount: z.number().int().nonnegative(),
  lastActivity: z.string().nullable(),
  revision: z.string(),
});

export const InvalidDocumentSchema = z.object({
  path: z.string(),
  title: z.string(),
  errors: z.array(z.string()),
});

export const DocumentListResponseSchema = z.object({
  repository: RepositoryInfoSchema,
  documents: z.array(DocumentSummarySchema),
  invalidDocuments: z.array(InvalidDocumentSchema),
});

export const WorkflowSectionsSchema = z.object({
  humanVerificationMarkdown: z.string().nullable(),
  remainingMarkdown: z.string().nullable(),
  commentLogMarkdown: z.string().nullable(),
});

export const DocumentChangeSchema = z.object({
  documentId: z.string().nullable(),
  changedAt: z.iso.datetime(),
});

export const DocumentDetailSchema = DocumentSummarySchema.extend({
  markdown: z.string(),
  frontmatter: FrontmatterSchema,
  workflow: WorkflowSectionsSchema,
});

export const StatusUpdateRequestSchema = z.object({
  revision: z.string().min(1),
  status: DocumentStatusSchema,
  actor: z.string().trim().min(1).max(80),
  note: z.string().trim().max(4000).optional(),
});

export const CommentRequestSchema = z.object({
  revision: z.string().min(1),
  actor: z.string().trim().min(1).max(80),
  comment: z.string().trim().min(1).max(10_000),
});

export const RevisionRequestSchema = z.object({
  revision: z.string().min(1),
  actor: z.string().trim().min(1).max(80),
});

export type DocumentSummary = z.infer<typeof DocumentSummarySchema>;
export type DocumentDetail = z.infer<typeof DocumentDetailSchema>;
export type DocumentListResponse = z.infer<typeof DocumentListResponseSchema>;
export type WorkflowSections = z.infer<typeof WorkflowSectionsSchema>;
export type DocumentChange = z.infer<typeof DocumentChangeSchema>;
