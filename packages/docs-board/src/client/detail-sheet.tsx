import {
  ArchiveIcon,
  MessageSquareTextIcon,
  ShieldCheckIcon,
} from "lucide-react";
import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { toast } from "sonner";

import {
  addDocumentComment,
  archiveDocument,
  updateDocumentStatus,
} from "./api.ts";
import { COLUMN_LABELS } from "./workflow.ts";
import { Badge } from "#components/ui/badge";
import { Button } from "#components/ui/button";
import { Input } from "#components/ui/input";
import { ScrollArea } from "#components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "#components/ui/sheet";
import { Skeleton } from "#components/ui/skeleton";
import { Textarea } from "#components/ui/textarea";
import {
  DOCUMENT_STATUSES,
  DocumentStatusSchema,
  type DocumentDetail,
  type DocumentStatus,
} from "#shared/schema";

export function DetailSheet({
  document,
  loading,
  actor,
  onClose,
  onChanged,
}: {
  document: DocumentDetail | null;
  loading: boolean;
  actor: string;
  onClose: () => void;
  onChanged: (document: DocumentDetail) => Promise<void>;
}): React.JSX.Element {
  const [comment, setComment] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const runMutation = async (
    operation: () => Promise<DocumentDetail>,
    message: string,
  ): Promise<void> => {
    setBusy(true);
    try {
      const updated = await operation();
      await onChanged(updated);
      toast.success(message);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Document update failed",
      );
    } finally {
      setBusy(false);
    }
  };

  const moveTo = async (status: DocumentStatus): Promise<void> => {
    if (document === null || status === document.status) return;
    await runMutation(
      () => updateDocumentStatus(document, status, actor, note || undefined),
      `Moved to ${COLUMN_LABELS[status]}`,
    );
    setNote("");
  };

  const addComment = async (): Promise<void> => {
    if (document === null || comment.trim() === "") return;
    await runMutation(
      () => addDocumentComment(document, actor, comment),
      "Comment appended to Markdown",
    );
    setComment("");
  };

  const archive = async (): Promise<void> => {
    if (document === null) return;
    await runMutation(
      () => archiveDocument(document, actor),
      "Document archived",
    );
  };

  return (
    <Sheet
      open={loading || document !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent className="w-full gap-0 p-0 sm:max-w-3xl">
        {document === null ? (
          <div className="space-y-4 p-6">
            <Skeleton className="h-7 w-2/3" />
            <Skeleton className="h-[70vh] w-full" />
          </div>
        ) : (
          <div className="flex h-svh flex-col">
            <SheetHeader className="border-b p-6">
              <div className="flex flex-wrap items-center gap-2 pr-8">
                <Badge variant="outline">{document.type}</Badge>
                <Badge variant="secondary">
                  {COLUMN_LABELS[document.status]}
                </Badge>
                {document.verification === "human" ? (
                  <Badge>
                    <ShieldCheckIcon /> Human verification
                  </Badge>
                ) : null}
              </div>
              <SheetTitle className="text-xl">{document.title}</SheetTitle>
              <SheetDescription className="font-mono text-xs">
                packages/docs/{document.path}
              </SheetDescription>
            </SheetHeader>
            <ScrollArea className="min-h-0 flex-1">
              <div className="p-6">
                <div className="typeset">
                  <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml>
                    {document.markdown}
                  </ReactMarkdown>
                </div>
              </div>
            </ScrollArea>
            <SheetFooter className="space-y-4 border-t bg-background p-5">
              <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                <Input
                  aria-label="Optional status note"
                  onChange={(event) => {
                    setNote(event.target.value);
                  }}
                  placeholder="Optional note for the status change"
                  value={note}
                />
                <label className="flex items-center gap-2 text-sm">
                  <span className="sr-only">Move document</span>
                  <select
                    aria-label="Move document to column"
                    className="h-8 rounded-lg border bg-background px-2 text-sm"
                    disabled={busy}
                    onChange={(event) => {
                      const result = DocumentStatusSchema.safeParse(
                        event.target.value,
                      );
                      if (result.success) void moveTo(result.data);
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
              </div>
              <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                <Textarea
                  aria-label="Comment"
                  onChange={(event) => {
                    setComment(event.target.value);
                  }}
                  placeholder={`Leave a steering note as ${actor}. It will be appended to the Markdown comment log.`}
                  rows={2}
                  value={comment}
                />
                <Button
                  disabled={busy || comment.trim() === ""}
                  onClick={() => void addComment()}
                >
                  <MessageSquareTextIcon /> Comment
                </Button>
              </div>
              {document.status === "complete" &&
              (document.type === "plan" || document.type === "todo") ? (
                <Button
                  disabled={busy}
                  onClick={() => void archive()}
                  variant="outline"
                >
                  <ArchiveIcon /> Archive completed document
                </Button>
              ) : null}
            </SheetFooter>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
