import {
  ApiErrorSchema,
  CommentRequestSchema,
  DocumentDetailSchema,
  DocumentListResponseSchema,
  RevisionRequestSchema,
  StatusUpdateRequestSchema,
  type DocumentDetail,
  type DocumentListResponse,
  type DocumentStatus,
} from "#shared/schema";

async function responseValue(response: Response): Promise<unknown> {
  return response.json();
}

async function checkedValue(response: Response): Promise<unknown> {
  const value = await responseValue(response);
  if (!response.ok) {
    const error = ApiErrorSchema.safeParse(value);
    throw new Error(
      error.success
        ? error.data.error
        : `Request failed (${String(response.status)})`,
    );
  }
  return value;
}

export async function listDocuments(): Promise<DocumentListResponse> {
  return DocumentListResponseSchema.parse(
    await checkedValue(await fetch("/api/documents")),
  );
}

export async function getDocument(id: string): Promise<DocumentDetail> {
  return DocumentDetailSchema.parse(
    await checkedValue(await fetch(`/api/documents/${encodeURIComponent(id)}`)),
  );
}

export async function updateDocumentStatus(
  document: DocumentDetail | { id: string; revision: string },
  status: DocumentStatus,
  actor: string,
  note?: string,
): Promise<DocumentDetail> {
  const body = StatusUpdateRequestSchema.parse({
    revision: document.revision,
    status,
    actor,
    note,
  });
  return DocumentDetailSchema.parse(
    await checkedValue(
      await fetch(`/api/documents/${encodeURIComponent(document.id)}/status`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    ),
  );
}

export async function addDocumentComment(
  document: DocumentDetail,
  actor: string,
  comment: string,
): Promise<DocumentDetail> {
  const body = CommentRequestSchema.parse({
    revision: document.revision,
    actor,
    comment,
  });
  return DocumentDetailSchema.parse(
    await checkedValue(
      await fetch(
        `/api/documents/${encodeURIComponent(document.id)}/comments`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
      ),
    ),
  );
}

export async function archiveDocument(
  document: DocumentDetail,
  actor: string,
): Promise<DocumentDetail> {
  const body = RevisionRequestSchema.parse({
    revision: document.revision,
    actor,
  });
  return DocumentDetailSchema.parse(
    await checkedValue(
      await fetch(`/api/documents/${encodeURIComponent(document.id)}/archive`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    ),
  );
}
