import type { VerifiedSession } from "./session.ts";
import { SyncHttpError, type SyncFetch } from "./sync.ts";
import { resolvedDraftKey } from "./workspace-state.ts";
import type { WorkspaceRecord } from "./workspace-storage.ts";

type AttachmentAccess = {
  record: WorkspaceRecord;
  session: VerifiedSession | null;
  fetchImpl?: SyncFetch | undefined;
  signal: AbortSignal;
};

export async function loadAttachment(
  taskId: string,
  commentId: string,
  access: AttachmentAccess,
): Promise<Blob> {
  const { record, session, signal } = access;
  const resolvedTaskId = resolvedDraftKey(record, taskId);
  const stored = responseAttachment(record, resolvedTaskId, commentId);
  if (stored !== null) return stored;
  if (session === null)
    throw new Error("This attachment is not available on this browser.");
  const headers = new Headers({ accept: "application/octet-stream" });
  if (session.token !== "")
    headers.set("authorization", "Bearer " + session.token);
  const response = await (access.fetchImpl ?? fetch)(
    session.origin +
      "/api/v1/tasks/" +
      encodeURIComponent(resolvedTaskId) +
      "/comments/" +
      encodeURIComponent(commentId) +
      "/file",
    { headers, cache: "no-store", redirect: "error", signal },
  );
  if (!response.ok) throw new SyncHttpError(response.status);
  return await response.blob();
}

function responseAttachment(
  record: WorkspaceRecord,
  taskId: string,
  commentId: string,
): Blob | null {
  const comment = record.data.tasks
    .find((task) => task.id === taskId && !task.is_deleted)
    ?.comments?.find((item) => item.id === commentId);
  if (comment?.file_name === undefined)
    throw new Error("This attachment is no longer available.");
  for (const entry of record.outbox) {
    const { command } = entry.queued;
    if (
      entry.rejection !== undefined ||
      command.type !== "TaskUpdate" ||
      command.args.id !== taskId
    )
      continue;
    const upload = command.args.append_comment;
    if (
      upload?.comment.id === commentId &&
      upload.attachment_base64 !== undefined
    ) {
      const bytes = Uint8Array.from(
        atob(upload.attachment_base64),
        (character) => character.codePointAt(0) ?? 0,
      );
      return new Blob([bytes], { type: "application/octet-stream" });
    }
  }
  return null;
}
