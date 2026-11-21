import { z } from "zod";
import type { CommentUpload, Task } from "../protocol/generated.ts";
import type { UpdateTaskInput } from "./types.ts";

const maxAttachmentBytes = 16 * 1024 * 1024;

export const CommentUploadSchema = z
  .object({
    comment: z.object({
      id: z.uuid(),
      body: z.string().trim().max(32_000),
      created_at: z.iso.datetime(),
      file_name: z
        .string()
        .min(1)
        .max(255)
        .regex(/^[^/\\\p{Cc}]+$/u)
        .refine((name) => name !== "." && name !== "..")
        .optional(),
    }),
    attachment_base64: z
      .string()
      .max(4 * Math.ceil(maxAttachmentBytes / 3))
      .pipe(z.base64())
      .optional(),
  })
  .refine(
    ({ comment, attachment_base64: bytes }) =>
      (comment.file_name === undefined) === (bytes === undefined) &&
      (comment.body !== "" || comment.file_name !== undefined) &&
      (bytes === undefined ||
        Buffer.byteLength(bytes, "base64") <= maxAttachmentBytes),
    "Invalid comment or attachment",
  )
  .transform(({ comment, attachment_base64: bytes }): CommentUpload => ({
    comment: {
      id: comment.id,
      body: comment.body,
      created_at: comment.created_at,
      ...(comment.file_name === undefined
        ? {}
        : { file_name: comment.file_name }),
    },
    ...(bytes === undefined ? {} : { attachment_base64: bytes }),
  }));

export function applyCommentMutation(
  task: Task,
  data: UpdateTaskInput,
  byTask: Map<string, Map<string, Uint8Array<ArrayBuffer>>>,
): void {
  if (
    data.appendComment === undefined &&
    data.removeCommentId === undefined &&
    data.removeAttachmentId === undefined
  )
    return;
  const attachments =
    byTask.get(task.id) ?? new Map<string, Uint8Array<ArrayBuffer>>();
  byTask.set(task.id, attachments);
  const upload = data.appendComment;
  if (upload !== undefined) {
    const comments = task.comments ?? [];
    if (comments.some((comment) => comment.id === upload.comment.id)) {
      throw new Error("Comment already exists");
    }
    task.comments = [...comments, upload.comment].toSorted(
      (a, b) =>
        Date.parse(a.created_at) - Date.parse(b.created_at) ||
        a.id.localeCompare(b.id),
    );
    if (upload.attachment_base64 !== undefined) {
      attachments.set(
        upload.comment.id,
        Uint8Array.from(Buffer.from(upload.attachment_base64, "base64")),
      );
    }
  }
  if (data.removeCommentId !== undefined) {
    task.comments = (task.comments ?? []).filter(
      (comment) => comment.id !== data.removeCommentId,
    );
    attachments.delete(data.removeCommentId);
  }
  if (data.removeAttachmentId !== undefined) {
    task.comments = (task.comments ?? []).flatMap((comment) => {
      if (comment.id !== data.removeAttachmentId) return [comment];
      if (comment.body === "") return [];
      const { file_name: _name, ...remaining } = comment;
      return [remaining];
    });
    attachments.delete(data.removeAttachmentId);
  }
}

export function storageComment(upload: CommentUpload) {
  return {
    id: upload.comment.id,
    body: upload.comment.body,
    createdAt: new Date(upload.comment.created_at),
    fileName: upload.comment.file_name ?? null,
    attachment:
      upload.attachment_base64 === undefined
        ? null
        : Uint8Array.from(Buffer.from(upload.attachment_base64, "base64")),
  };
}
