import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  CircleDotDashedIcon,
  Clock3Icon,
  FileTextIcon,
  GripVerticalIcon,
  MessageSquareTextIcon,
  RefreshCwIcon,
  SearchIcon,
  TriangleAlertIcon,
  UserCheckIcon,
} from "lucide-react";
import { useMemo, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";

import { getDocument, listDocuments, updateDocumentStatus } from "./api.ts";
import { DetailSheet } from "./detail-sheet.tsx";
import { COLUMN_HINTS, COLUMN_LABELS } from "./workflow.ts";
import { Badge } from "#components/ui/badge";
import { Button } from "#components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "#components/ui/card";
import { Input } from "#components/ui/input";
import { ScrollArea, ScrollBar } from "#components/ui/scroll-area";
import { Skeleton } from "#components/ui/skeleton";
import { Toaster } from "#components/ui/sonner";
import {
  DOCUMENT_STATUSES,
  DocumentStatusSchema,
  type DocumentDetail,
  type DocumentListResponse,
  type DocumentStatus,
  type DocumentSummary,
} from "#shared/schema";

type DocsSnapshot = {
  data: DocumentListResponse | null;
  error: string | null;
  loading: boolean;
};

let docsSnapshot: DocsSnapshot = { data: null, error: null, loading: true };
let docsEvents: EventSource | null = null;
const docsListeners = new Set<() => void>();

function publishSnapshot(snapshot: DocsSnapshot): void {
  docsSnapshot = snapshot;
  for (const listener of docsListeners) listener();
}

async function refreshDocs(): Promise<void> {
  try {
    publishSnapshot({
      data: await listDocuments(),
      error: null,
      loading: false,
    });
  } catch (error) {
    publishSnapshot({
      data: docsSnapshot.data,
      error:
        error instanceof Error ? error.message : "Could not read packages/docs",
      loading: false,
    });
  }
}

function subscribeDocs(listener: () => void): () => void {
  docsListeners.add(listener);
  if (docsListeners.size === 1) {
    void refreshDocs();
    docsEvents = new EventSource("/api/events");
    docsEvents.addEventListener("documents", () => {
      void refreshDocs();
    });
  }
  return () => {
    docsListeners.delete(listener);
    if (docsListeners.size === 0) {
      docsEvents?.close();
      docsEvents = null;
    }
  };
}

function getDocsSnapshot(): DocsSnapshot {
  return docsSnapshot;
}

function formatActivity(value: string | null): string {
  if (value === null) return "No activity yet";
  const timestamp = value.split(" - ").at(0);
  if (timestamp === undefined) return value;
  const date = new Date(timestamp);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString();
}

function BoardCard({
  document,
  onOpen,
}: {
  document: DocumentSummary;
  onOpen: () => void;
}): React.JSX.Element {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({ id: document.id });
  const style: React.CSSProperties =
    transform === null
      ? {}
      : {
          transform: `translate3d(${String(transform.x)}px, ${String(transform.y)}px, 0)`,
        };

  return (
    <Card
      ref={setNodeRef}
      style={style}
      className={
        isDragging
          ? "relative z-50 opacity-70 shadow-xl"
          : "transition-shadow hover:shadow-md"
      }
    >
      <CardHeader>
        <button className="min-w-0 text-left" onClick={onOpen} type="button">
          <CardTitle>{document.title}</CardTitle>
          <CardDescription className="mt-1 truncate font-mono text-[11px]">
            {document.path}
          </CardDescription>
        </button>
        <CardAction>
          <Button
            aria-label={`Drag ${document.title}`}
            className="touch-none text-muted-foreground"
            size="icon-sm"
            variant="ghost"
            {...attributes}
            {...listeners}
          >
            <GripVerticalIcon />
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-1.5">
          <Badge variant="outline">{document.type}</Badge>
          {document.disposition !== null &&
          document.disposition !== "active" ? (
            <Badge
              variant={
                document.disposition === "blocked" ? "destructive" : "secondary"
              }
            >
              {document.disposition}
            </Badge>
          ) : null}
          {document.verification === "human" ? (
            <Badge variant="secondary">
              <UserCheckIcon /> human
            </Badge>
          ) : null}
        </div>
      </CardContent>
      <CardFooter className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
        <div className="flex items-center gap-1.5">
          <span className="flex items-center gap-1.5">
            <CircleDotDashedIcon className="size-3.5" />
            {document.remainingCount} remaining
          </span>
        </div>
        <span className="flex items-center justify-end gap-1.5">
          <MessageSquareTextIcon className="size-3.5" />
          {document.commentCount}
        </span>
        <button
          className="col-span-2 flex w-full items-center gap-1.5 text-left text-[11px] text-muted-foreground"
          onClick={onOpen}
          type="button"
        >
          <Clock3Icon className="size-3" />
          <span className="truncate">
            {formatActivity(document.lastActivity)}
          </span>
        </button>
      </CardFooter>
    </Card>
  );
}

function BoardColumn({
  status,
  documents,
  onOpen,
}: {
  status: DocumentStatus;
  documents: DocumentSummary[];
  onOpen: (id: string) => void;
}): React.JSX.Element {
  const { isOver, setNodeRef } = useDroppable({ id: status });
  return (
    <section
      className="w-[330px] shrink-0"
      aria-labelledby={`column-${status}`}
    >
      <div className="mb-3 flex items-start justify-between px-1">
        <div>
          <h2
            className="max-w-[270px] text-sm font-semibold uppercase tracking-[0.08em]"
            id={`column-${status}`}
          >
            {COLUMN_LABELS[status]}
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {COLUMN_HINTS[status]}
          </p>
        </div>
        <Badge variant="secondary">{documents.length}</Badge>
      </div>
      <div
        ref={setNodeRef}
        className={`min-h-[54vh] space-y-3 rounded-2xl border border-dashed p-2 transition-colors ${isOver ? "border-foreground/40 bg-accent" : "border-border/70 bg-muted/35"}`}
      >
        {documents.map((document) => (
          <BoardCard
            document={document}
            key={document.id}
            onOpen={() => {
              onOpen(document.id);
            }}
          />
        ))}
        {documents.length === 0 ? (
          <div className="grid min-h-28 place-items-center text-center text-xs text-muted-foreground">
            Drop a document here
          </div>
        ) : null}
      </div>
    </section>
  );
}

export function App(): React.JSX.Element {
  const store = useSyncExternalStore(
    subscribeDocs,
    getDocsSnapshot,
    getDocsSnapshot,
  );
  const data = store.data;
  const [selectedDocument, setSelectedDocument] =
    useState<DocumentDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 7 } }),
    useSensor(KeyboardSensor),
  );

  const openDocument = async (id: string): Promise<void> => {
    setDetailLoading(true);
    setSelectedDocument(null);
    try {
      setSelectedDocument(await getDocument(id));
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not load document",
      );
    } finally {
      setDetailLoading(false);
    }
  };

  const visibleDocuments = useMemo(() => {
    if (data === null) return [];
    const normalizedQuery = query.trim().toLowerCase();
    return data.documents.filter((document) => {
      const inScope = showAll || normalizedQuery !== "" || document.board;
      const matches =
        normalizedQuery === "" ||
        `${document.title} ${document.path} ${document.type} ${document.status}`
          .toLowerCase()
          .includes(normalizedQuery);
      return inScope && matches;
    });
  }, [data, query, showAll]);

  const handleDragEnd = async (event: DragEndEvent): Promise<void> => {
    if (data === null || event.over === null) return;
    const status = DocumentStatusSchema.safeParse(String(event.over.id));
    const document = data.documents.find(
      (candidate) => candidate.id === String(event.active.id),
    );
    if (
      !status.success ||
      document === undefined ||
      document.status === status.data
    )
      return;
    try {
      await updateDocumentStatus(document, status.data, data.repository.actor);
      await refreshDocs();
      toast.success(`Moved to ${COLUMN_LABELS[status.data]}`);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not move document",
      );
    }
  };

  return (
    <main className="min-h-svh bg-background text-foreground">
      <header className="border-b bg-background/95 px-5 py-5 backdrop-blur md:px-8">
        <div className="mx-auto flex max-w-[1530px] flex-col gap-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
                <FileTextIcon className="size-3.5" /> Markdown is the database
              </div>
              <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">
                Docs Workboard
              </h1>
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                Steer agent work now. Verify and sign off when the deployed
                result is ready.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {data === null ? null : (
                <>
                  <Badge variant="outline">{data.repository.branch}</Badge>
                  <Badge
                    variant={
                      data.repository.dirty ? "destructive" : "secondary"
                    }
                  >
                    {data.repository.dirty
                      ? "Uncommitted changes"
                      : "Clean checkout"}
                  </Badge>
                  <Badge variant="secondary">{data.repository.actor}</Badge>
                </>
              )}
              <Button
                aria-label="Refresh documents"
                disabled={store.loading}
                onClick={() => void refreshDocs()}
                size="icon"
                variant="outline"
              >
                <RefreshCwIcon
                  className={store.loading ? "animate-spin" : ""}
                />
              </Button>
            </div>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <div className="relative flex-1">
              <SearchIcon className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-9"
                onChange={(event) => {
                  setQuery(event.target.value);
                }}
                placeholder="Search every document by title, path, type, or status…"
                value={query}
              />
            </div>
            <Button
              onClick={() => {
                setShowAll((value) => !value);
              }}
              variant={showAll ? "secondary" : "outline"}
            >
              {showAll ? "Showing all docs" : "Show reference docs"}
            </Button>
          </div>
        </div>
      </header>

      {store.error === null ? null : (
        <div className="mx-auto mt-5 flex max-w-[1530px] items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" /> {store.error}
        </div>
      )}

      {data !== null && data.invalidDocuments.length > 0 ? (
        <div className="mx-auto mt-5 flex max-w-[1530px] items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />
          <div>
            <strong>{data.invalidDocuments.length} invalid document(s)</strong>
            <p className="mt-1 text-xs">
              {data.invalidDocuments
                .slice(0, 3)
                .map(
                  (document) =>
                    `${document.path}: ${document.errors.join(", ")}`,
                )
                .join(" · ")}
            </p>
          </div>
        </div>
      ) : null}

      <ScrollArea className="mx-auto max-w-[1600px]">
        <div className="flex min-w-max gap-4 px-5 py-7 md:px-8">
          {store.loading && data === null
            ? DOCUMENT_STATUSES.map((status) => (
                <Skeleton
                  className="h-[65vh] w-[330px] rounded-2xl"
                  key={status}
                />
              ))
            : null}
          {data === null ? null : (
            <DndContext
              collisionDetection={closestCenter}
              onDragEnd={(event) => void handleDragEnd(event)}
              sensors={sensors}
            >
              {DOCUMENT_STATUSES.map((status) => (
                <BoardColumn
                  documents={visibleDocuments.filter(
                    (document) => document.status === status,
                  )}
                  key={status}
                  onOpen={(id) => {
                    void openDocument(id);
                  }}
                  status={status}
                />
              ))}
            </DndContext>
          )}
        </div>
        <ScrollBar orientation="horizontal" />
      </ScrollArea>

      {data === null ? null : (
        <DetailSheet
          actor={data.repository.actor}
          document={selectedDocument}
          loading={detailLoading}
          onChanged={async (document) => {
            setSelectedDocument(document);
            await refreshDocs();
          }}
          onClose={() => {
            setDetailLoading(false);
            setSelectedDocument(null);
          }}
        />
      )}
      <Toaster position="bottom-right" richColors />
    </main>
  );
}
