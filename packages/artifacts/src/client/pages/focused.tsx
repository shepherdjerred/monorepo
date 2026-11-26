import { useCallback, useMemo, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router";
import { useCreateThread, useSetResolved } from "#client/data/mutations.ts";
import { useLiveUpdates } from "#client/data/live.ts";
import { pinsOf } from "#client/lib/pins.ts";
import { Composer } from "#client/threads/composer.tsx";
import { requestReply } from "#client/threads/reply-event.ts";
import {
  filterThreads,
  ThreadList,
  WaitingHeader,
  useThreadFilter,
} from "#client/threads/thread-panel.tsx";
import { ArtifactViewer } from "#client/viewers/artifact-viewer.tsx";
import type { AnchorAdapter, PresetId } from "#client/viewers/types.ts";
import { useFocusedData } from "./focused-data.ts";
import { defaultPreset, FocusedHeader } from "./focused-header.tsx";
import { useReviewKeys } from "./focused-shortcuts.ts";
import { PlacementComposer, type Placement } from "./placement-composer.tsx";

const FRAME_KINDS = new Set(["html", "site", "mermaid"]);

function Message({ children }: { readonly children: React.ReactNode }) {
  return (
    <main className="ar-page" id="content" tabIndex={-1}>
      {children}
    </main>
  );
}

export function FocusedPage(): React.JSX.Element {
  const { artifactId = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const { artifact, sorted, shown, version, all } = useFocusedData(
    artifactId,
    Number(params.get("v")),
  );
  useLiveUpdates(artifact.data?.boardSlug);

  const [filter, setFilter] = useThreadFilter();
  const [commentMode, setCommentMode] = useState(false);
  const [active, setActive] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [placement, setPlacement] = useState<Placement | null>(null);
  const [presetChoice, setPreset] = useState<PresetId | null>(null);
  const adapterRef = useRef<AnchorAdapter | null>(null);
  const [pane, setPane] = useState<HTMLElement | null>(null);
  const create = useCreateThread();
  const resolve = useSetResolved();

  const numbered = useMemo(
    () => new Map(all.map((thread, position) => [thread.id, position + 1])),
    [all],
  );
  const visible = filterThreads(all, filter);
  const pins = useMemo(
    () =>
      pinsOf(visible, shown?.number ?? null).map((pin) => ({
        ...pin,
        index: numbered.get(pin.id) ?? pin.index,
      })),
    [visible, shown?.number, numbered],
  );

  const select = useCallback(
    (threadId: string) => {
      setSelectedId(threadId);
      const thread = all.find((candidate) => candidate.id === threadId);
      if (thread !== undefined) adapterRef.current?.reveal?.(thread.anchor);
      document
        .querySelector(`[id="thread-${threadId}"]`)
        ?.scrollIntoView({ block: "nearest" });
    },
    [all],
  );

  const showVersion = useCallback(
    (number: number) => {
      setParams({ v: String(number) }, { replace: true });
      setPlacement(null);
    },
    [setParams],
  );

  const kind = artifact.data?.kind;
  const framed = kind !== undefined && FRAME_KINDS.has(kind);

  useReviewKeys({
    framed,
    active,
    commentMode,
    placing: placement !== null,
    selected: all.find((thread) => thread.id === selectedId),
    toggleCommentMode: () => {
      setCommentMode((value) => !value);
      setActive(false);
    },
    setActive,
    setCommentMode,
    cancelPlacement: () => {
      setPlacement(null);
    },
    step: (direction) => {
      const at = visible.findIndex((thread) => thread.id === selectedId);
      const next = visible[(at + direction + visible.length) % visible.length];
      if (next !== undefined) select(next.id);
    },
    version: (direction) => {
      const at = sorted.findIndex((candidate) => candidate.id === shown?.id);
      const next = sorted[at - direction];
      if (next !== undefined) showVersion(next.number);
    },
    replyTo: requestReply,
    toggleResolved: (thread) => {
      resolve.mutate({
        threadId: thread.id,
        resolved: thread.state === "open",
      });
    },
  });

  if (artifact.isError)
    return (
      <Message>
        <h1>Artifact not found</h1>
        <p role="alert">{artifact.error.message}</p>
      </Message>
    );
  if (shown === undefined || artifact.data === undefined)
    return (
      <Message>
        <p className="ar-empty" role="status">
          Loading…
        </p>
      </Message>
    );

  const detail = artifact.data;
  const latest = sorted[0]?.number ?? shown.number;

  function submitPlacement(body: string): void {
    if (placement === null || shown === undefined) return;
    create.mutate(
      {
        board: detail.boardSlug,
        artifactId: detail.id,
        versionId: shown.id,
        anchor: placement.anchor,
        body,
      },
      {
        onSuccess: (thread) => {
          setPlacement(null);
          setCommentMode(false);
          setSelectedId(thread.id);
          setFilter("open");
        },
      },
    );
  }

  return (
    <main className="ar-focus" id="content" tabIndex={-1}>
      <title>{`${detail.title} · Artifacts`}</title>
      <FocusedHeader
        title={detail.title}
        boardSlug={detail.boardSlug}
        boardTitle={detail.boardTitle}
        versions={sorted}
        shown={shown}
        version={version}
        framed={framed}
        preset={presetChoice ?? defaultPreset(shown.viewport)}
        onPreset={setPreset}
        commentMode={commentMode}
        onCommentMode={(on) => {
          setCommentMode(on);
          if (on) setActive(false);
        }}
        onVersion={showVersion}
      />
      <div className="ar-focus-body">
        <section className="ar-viewer-pane" ref={setPane} aria-label="Artifact">
          {version === undefined ? (
            <p className="ar-empty" role="status">
              Loading version…
            </p>
          ) : (
            <ArtifactViewer
              artifact={{
                id: detail.id,
                title: detail.title,
                kind: detail.kind,
              }}
              version={version}
              mode="focus"
              active={active}
              onActiveChange={setActive}
              preset={presetChoice ?? defaultPreset(shown.viewport)}
              adapterRef={adapterRef}
              review={{
                commentMode,
                pins,
                selectedId,
                onSelect: select,
                onPlace: (anchor, at) => {
                  setPlacement({ anchor, at });
                },
              }}
            />
          )}
          {placement === null ? null : (
            <PlacementComposer
              placement={placement}
              pane={pane}
              pending={create.isPending}
              onSubmit={submitPlacement}
              onCancel={() => {
                setPlacement(null);
              }}
            />
          )}
          {commentMode && placement === null ? (
            <p className="ar-mode-hint" role="status">
              Comment mode: click where the comment belongs. Esc to leave.
            </p>
          ) : null}
        </section>
        <aside className="ar-sidebar" aria-label="Threads">
          <WaitingHeader scope={{ type: "artifact", artifactId: detail.id }} />
          <ThreadList
            threads={all}
            filter={filter}
            onFilter={setFilter}
            selectedId={selectedId}
            onSelect={select}
            currentVersion={latest}
            viewedVersion={shown.number}
            indexOf={(thread) => numbered.get(thread.id) ?? null}
            onViewVersion={showVersion}
            empty={
              filter === "open"
                ? "No open threads. Press C and click to comment."
                : "No threads here."
            }
          />
          <Composer
            label="General comment"
            pending={create.isPending}
            onSubmit={(body) => {
              create.mutate({
                board: detail.boardSlug,
                artifactId: detail.id,
                versionId: shown.id,
                anchor: { type: "general" },
                body,
              });
            }}
          />
        </aside>
      </div>
    </main>
  );
}
