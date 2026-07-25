import type { DocumentListResponse, DocumentStatus } from "#shared/schema";

export function moveDocumentInList(
  current: DocumentListResponse,
  id: string,
  status: DocumentStatus,
): DocumentListResponse {
  return {
    ...current,
    documents: current.documents.map((document) =>
      document.id === id ? { ...document, status } : document,
    ),
  };
}
