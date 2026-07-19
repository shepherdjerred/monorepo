import { initTRPC, TRPCError } from "@trpc/server";
import { z } from "zod";

import type { DocumentStore } from "#server/document-store";
import {
  DocumentConflictError,
  DocumentNotFoundError,
  DocumentWorkflowError,
} from "#server/document-store";
import {
  CommentRequestSchema,
  DocumentChangeSchema,
  DocumentDetailSchema,
  DocumentIdSchema,
  DocumentListResponseSchema,
  RevisionRequestSchema,
  StatusUpdateRequestSchema,
  type DocumentChange,
} from "#shared/schema";

const ByIdInputSchema = z.object({ id: DocumentIdSchema });
const StatusInputSchema = StatusUpdateRequestSchema.extend({
  id: DocumentIdSchema,
});
const CommentInputSchema = CommentRequestSchema.extend({
  id: DocumentIdSchema,
});
const ArchiveInputSchema = RevisionRequestSchema.extend({
  id: DocumentIdSchema,
});

export type TRPCContext = {
  store: DocumentStore;
};

const t = initTRPC.context<TRPCContext>().create();

async function runDocumentOperation<T>(
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof DocumentNotFoundError) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Document not found" });
    }
    if (error instanceof DocumentConflictError) {
      throw new TRPCError({ code: "CONFLICT", message: error.message });
    }
    if (error instanceof DocumentWorkflowError) {
      throw new TRPCError({
        code: "UNPROCESSABLE_CONTENT",
        message: error.message,
      });
    }
    throw error;
  }
}

type ChangeSignal =
  | { kind: "change"; event: DocumentChange }
  | { kind: "abort" };

async function* subscribeToDocumentChanges(
  store: DocumentStore,
  signal: AbortSignal | undefined,
): AsyncGenerator<DocumentChange> {
  const subscriptionSignal = signal ?? new AbortController().signal;
  const queued: DocumentChange[] = [];
  let resolveNext: ((value: ChangeSignal) => void) | null = null;
  const publish = (event: DocumentChange): void => {
    const resolve = resolveNext;
    if (resolve === null) {
      queued.push(event);
      return;
    }
    resolveNext = null;
    resolve({ kind: "change", event });
  };
  const abort = (): void => {
    const resolve = resolveNext;
    if (resolve === null) return;
    resolveNext = null;
    resolve({ kind: "abort" });
  };
  const unsubscribe = store.subscribe(publish);
  subscriptionSignal.addEventListener("abort", abort, { once: true });
  try {
    while (!subscriptionSignal.aborted) {
      const queuedEvent = queued.shift();
      if (queuedEvent !== undefined) {
        yield DocumentChangeSchema.parse(queuedEvent);
        continue;
      }
      const next = await new Promise<ChangeSignal>((resolve) => {
        resolveNext = resolve;
      });
      if (next.kind === "abort") return;
      yield DocumentChangeSchema.parse(next.event);
    }
  } finally {
    subscriptionSignal.removeEventListener("abort", abort);
    unsubscribe();
  }
}

const documentsRouter = t.router({
  list: t.procedure
    .output(DocumentListResponseSchema)
    .query(({ ctx }) => runDocumentOperation(() => ctx.store.list())),
  byId: t.procedure
    .input(ByIdInputSchema)
    .output(DocumentDetailSchema)
    .query(({ ctx, input }) =>
      runDocumentOperation(() => ctx.store.get(input.id)),
    ),
  updateStatus: t.procedure
    .input(StatusInputSchema)
    .output(DocumentDetailSchema)
    .mutation(({ ctx, input }) =>
      runDocumentOperation(() =>
        ctx.store.updateStatus(input.id, {
          revision: input.revision,
          status: input.status,
          actor: input.actor,
          note: input.note,
        }),
      ),
    ),
  addComment: t.procedure
    .input(CommentInputSchema)
    .output(DocumentDetailSchema)
    .mutation(({ ctx, input }) =>
      runDocumentOperation(() =>
        ctx.store.addComment(
          input.id,
          input.revision,
          input.actor,
          input.comment,
        ),
      ),
    ),
  archive: t.procedure
    .input(ArchiveInputSchema)
    .output(DocumentDetailSchema)
    .mutation(({ ctx, input }) =>
      runDocumentOperation(() =>
        ctx.store.archive(input.id, input.revision, input.actor),
      ),
    ),
  changes: t.procedure.subscription(({ ctx, signal }) =>
    subscribeToDocumentChanges(ctx.store, signal),
  ),
});

export const appRouter = t.router({ documents: documentsRouter });

export type AppRouter = typeof appRouter;
