import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { inferRouterOutputs } from "@trpc/server";
import {
  ArchiveIcon,
  CheckCircle2Icon,
  MessageSquareTextIcon,
  RotateCcwIcon,
  Undo2Icon,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { useTRPC } from "./trpc.ts";
import { COLUMN_LABELS } from "./workflow.ts";
import type { AppRouter } from "#server/trpc";
import { Button } from "#components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "#components/ui/card";
import { Textarea } from "#components/ui/textarea";
import {
  DOCUMENT_STATUSES,
  DocumentStatusSchema,
  type DocumentDetail,
  type DocumentStatus,
} from "#shared/schema";

type DocumentOutput = inferRouterOutputs<AppRouter>["documents"]["byId"];

function reviewDescription(status: DocumentStatus): string {
  return status === "awaiting-human"
    ? "Record your decision. Requesting changes requires a reason."
    : "Move the workflow forward or reopen it with an audit note.";
}

function notePlaceholder(status: DocumentStatus): string {
  if (status === "awaiting-human") {
    return "Evidence for signoff, or what needs to change…";
  }
  if (status === "complete") return "Reason for reopening…";
  return "Optional note for this status change…";
}

function ReviewControls({
  actor,
  busy,
  document,
  note,
  onStatus,
}: {
  actor: string | undefined;
  busy: boolean;
  document: DocumentDetail;
  note: string;
  onStatus: (status: DocumentStatus, requiredNote?: boolean) => void;
}): React.JSX.Element {
  if (document.status === "awaiting-human") {
    return (
      <div className="grid gap-2">
        <Button
          disabled={busy || actor === undefined}
          onClick={() => {
            onStatus("complete");
          }}
        >
          <CheckCircle2Icon /> Confirm complete
        </Button>
        <Button
          disabled={busy || actor === undefined || note.trim() === ""}
          onClick={() => {
            onStatus("in-progress", true);
          }}
          variant="outline"
        >
          <Undo2Icon /> Request changes
        </Button>
      </div>
    );
  }

  if (document.status === "complete") {
    return (
      <Button
        className="w-full"
        disabled={busy || actor === undefined || note.trim() === ""}
        onClick={() => {
          onStatus("in-progress", true);
        }}
        variant="outline"
      >
        <RotateCcwIcon /> Reopen work
      </Button>
    );
  }

  return (
    <label className="grid gap-1.5 text-xs font-medium text-muted-foreground">
      Move to
      <select
        aria-label="Move document to column"
        className="h-9 rounded-lg border bg-background px-3 text-sm text-foreground"
        disabled={busy || actor === undefined}
        onChange={(event) => {
          const status = DocumentStatusSchema.safeParse(event.target.value);
          if (status.success && status.data !== document.status) {
            onStatus(status.data);
          }
        }}
        value={document.status}
      >
        {DOCUMENT_STATUSES.map((status) => (
          <option key={status} value={status}>
            {COLUMN_LABELS[status]}
          </option>
        ))}
      </select>
    </label>
  );
}

export function DocumentSidebar({
  actor,
  document,
}: {
  actor: string | undefined;
  document: DocumentDetail;
}): React.JSX.Element {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [comment, setComment] = useState("");
  const [note, setNote] = useState("");
  const listKey = trpc.documents.list.queryKey();

  const handleError = (
    message: string,
    code: string | undefined,
    id: string,
  ): void => {
    if (code === "CONFLICT") {
      void queryClient.invalidateQueries({ queryKey: listKey });
      void queryClient.invalidateQueries({
        queryKey: trpc.documents.byId.queryKey({ id }),
      });
    }
    toast.error(message);
  };
  const cacheDocument = (updated: DocumentOutput): void => {
    queryClient.setQueryData(
      trpc.documents.byId.queryKey({ id: updated.id }),
      updated,
    );
    void queryClient.invalidateQueries({ queryKey: listKey });
  };

  const statusMutation = useMutation(
    trpc.documents.updateStatus.mutationOptions({
      onError: (error, input) => {
        handleError(error.message, error.data?.code, input.id);
      },
      onSuccess: (updated, input) => {
        cacheDocument(updated);
        setNote("");
        toast.success(`Moved to ${COLUMN_LABELS[input.status]}`);
      },
    }),
  );
  const commentMutation = useMutation(
    trpc.documents.addComment.mutationOptions({
      onError: (error, input) => {
        handleError(error.message, error.data?.code, input.id);
      },
      onSuccess: (updated) => {
        cacheDocument(updated);
        setComment("");
        toast.success("Comment appended to Markdown");
      },
    }),
  );
  const archiveMutation = useMutation(
    trpc.documents.archive.mutationOptions({
      onError: (error, input) => {
        handleError(error.message, error.data?.code, input.id);
      },
      onSuccess: (updated) => {
        cacheDocument(updated);
        toast.success("Document archived");
      },
    }),
  );
  const busy =
    statusMutation.isPending ||
    commentMutation.isPending ||
    archiveMutation.isPending;

  const updateStatus = (status: DocumentStatus, requiredNote = false): void => {
    if (actor === undefined) return;
    const trimmedNote = note.trim();
    if (requiredNote && trimmedNote === "") return;
    statusMutation.mutate({
      id: document.id,
      revision: document.revision,
      status,
      actor,
      note: trimmedNote === "" ? undefined : trimmedNote,
    });
  };
  const addComment = (): void => {
    if (actor === undefined || comment.trim() === "") return;
    commentMutation.mutate({
      id: document.id,
      revision: document.revision,
      actor,
      comment,
    });
  };
  const archive = (): void => {
    if (actor === undefined) return;
    archiveMutation.mutate({
      id: document.id,
      revision: document.revision,
      actor,
    });
  };

  return (
    <aside className="space-y-5 lg:sticky lg:top-5">
      <Card>
        <CardHeader>
          <CardTitle>Review action</CardTitle>
          <CardDescription>
            {reviewDescription(document.status)}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            aria-label="Workflow note"
            disabled={busy}
            onChange={(event) => {
              setNote(event.target.value);
            }}
            placeholder={notePlaceholder(document.status)}
            rows={4}
            value={note}
          />
          <ReviewControls
            actor={actor}
            busy={busy}
            document={document}
            note={note}
            onStatus={updateStatus}
          />
          {document.status === "complete" &&
          (document.type === "plan" || document.type === "todo") ? (
            <Button
              className="w-full"
              disabled={busy || actor === undefined}
              onClick={archive}
              variant="outline"
            >
              <ArchiveIcon /> Archive document
            </Button>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Leave a comment</CardTitle>
          <CardDescription>
            Append a durable steering note as {actor ?? "the reviewer"}.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            aria-label="Comment"
            disabled={busy}
            onChange={(event) => {
              setComment(event.target.value);
            }}
            placeholder="Context for the next agent or future you…"
            rows={5}
            value={comment}
          />
          <Button
            className="w-full"
            disabled={busy || actor === undefined || comment.trim() === ""}
            onClick={addComment}
            variant="secondary"
          >
            <MessageSquareTextIcon /> Add comment
          </Button>
        </CardContent>
      </Card>
    </aside>
  );
}
