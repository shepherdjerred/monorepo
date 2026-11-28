import { ListIcon } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { Link, Navigate, useParams, useSearchParams } from "react-router";
import { useCreateThread } from "#client/data/mutations.ts";
import { useLiveUpdates } from "#client/data/live.ts";
import { useBoard, useBoardThreads } from "#client/data/queries.ts";
import { Canvas } from "#client/canvas/canvas.tsx";
import { canvasPins, frameModels } from "#client/canvas/model.ts";
import { CommentsPanel } from "#client/shell/comments-panel.tsx";
import { FloatingNav } from "#client/shell/floating-nav.tsx";
import {
  NARROW_QUERY,
  PANEL_CLEARANCE,
  usePanelInset,
  usePanelState,
} from "#client/shell/panel-state.ts";
import { Composer } from "#client/threads/composer.tsx";
import {
  ThreadList,
  WaitingHeader,
  useThreadFilter,
} from "#client/threads/thread-panel.tsx";

/**
 * The board as a free canvas of frames, with the board's threads beside it.
 * The outline route is the keyboard and screen-reader path to the same data.
 */
export function BoardPage(): React.JSX.Element {
  const { slug = "" } = useParams();
  const [params] = useSearchParams();
  useLiveUpdates(slug);
  const board = useBoard(slug);
  const threads = useBoardThreads(slug);
  const create = useCreateThread();
  const [filter, setFilter] = useThreadFilter();
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);

  const frames = useMemo(
    () => (board.data === undefined ? [] : frameModels(board.data)),
    [board.data],
  );
  const all = useMemo(() => threads.data ?? [], [threads.data]);
  const pins = useMemo(
    () => canvasPins(all, new Map(frames.map((frame) => [frame.id, frame]))),
    [all, frames],
  );
  const titles = useMemo(
    () => new Map(frames.map((frame) => [frame.id, frame.summary.title])),
    [frames],
  );
  const panel = usePanelState("board");
  const openCount = all.filter((thread) => thread.state === "open").length;
  // A wide screen keeps the open panel's strip clear; a narrow one overlays a sheet.
  const wide = !globalThis.matchMedia(NARROW_QUERY).matches;
  const inset = wide && !panel.collapsed ? PANEL_CLEARANCE : 0;
  usePanelInset(inset);
  const { expand } = panel;
  const selectThread = useCallback(
    (id: string | null) => {
      setSelectedThreadId(id);
      if (id === null) return;
      // Selecting a thread (a pin, J/K, a new comment) opens the panel on it.
      expand();
      requestAnimationFrame(() => {
        document
          .querySelector(`[id="thread-${id}"]`)
          ?.scrollIntoView({ block: "nearest" });
      });
    },
    [expand],
  );
  const pinNumber = useMemo(
    () => new Map(pins.map((pin) => [pin.id, pin.index])),
    [pins],
  );

  if (board.isError)
    return (
      <main className="ar-page" id="content" tabIndex={-1}>
        <h1>Board not found</h1>
        <p role="alert">{board.error.message}</p>
        <Link to="/">Back to the inbox</Link>
      </main>
    );
  if (board.data === undefined)
    return (
      <main className="ar-page" id="content" tabIndex={-1}>
        <p className="ar-empty" role="status">
          Loading…
        </p>
      </main>
    );

  // A board launched on one artifact opens on it; `?view=canvas` shows the canvas.
  const { launch } = board.data.index;
  if (
    launch.view === "focused" &&
    launch.artifactId !== undefined &&
    params.get("view") !== "canvas"
  )
    return <Navigate replace to={`/a/${launch.artifactId}`} />;

  return (
    <main className="ar-board" id="content" tabIndex={-1}>
      <title>{`${board.data.board.title} · Artifacts`}</title>
      <Canvas
        key={slug}
        slug={slug}
        data={board.data}
        pins={pins}
        selectedThreadId={selectedThreadId}
        onSelectThread={selectThread}
        rightInset={inset}
      />
      <FloatingNav
        lead={<h1 className="ar-fnav-title">{board.data.board.title}</h1>}
        actions={
          <Link
            className="ar-icon-button"
            to={`/b/${slug}/outline`}
            aria-label="List view"
            title="List view"
          >
            <ListIcon aria-hidden="true" />
          </Link>
        }
        menu={[{ key: "list", label: "List view", to: `/b/${slug}/outline` }]}
      />
      <CommentsPanel
        state={panel}
        scope={{ board: slug }}
        openCount={openCount}
      >
        <WaitingHeader scope={{ type: "board", board: slug }} />
        <ThreadList
          threads={all}
          filter={filter}
          onFilter={setFilter}
          selectedId={selectedThreadId}
          onSelect={selectThread}
          currentVersion={null}
          indexOf={(thread) => pinNumber.get(thread.id) ?? null}
          contextOf={(thread) =>
            thread.artifactId === null
              ? null
              : (titles.get(thread.artifactId) ?? null)
          }
          empty="No comments yet. Press C and click the canvas to pin one."
        />
        <Composer
          label="Comment on the board"
          pending={create.isPending}
          onSubmit={(body) => {
            create.mutate({
              board: slug,
              anchor: { type: "board", page: 0, x: 0, y: 0 },
              body,
            });
          }}
        />
      </CommentsPanel>
    </main>
  );
}
