import { noop } from "#client/lib/noop.ts";
import { useMemo, useState } from "react";
import {
  Link,
  Navigate,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router";
import { useCreateThread } from "#client/data/mutations.ts";
import { useLiveUpdates } from "#client/data/live.ts";
import {
  useArtifactDetails,
  useBoard,
  useBoardThreads,
} from "#client/data/queries.ts";
import { selectLiveFrames } from "#client/lib/budget.ts";
import { useShortcuts } from "#client/shell/shortcuts.ts";
import { Composer } from "#client/threads/composer.tsx";
import {
  ThreadList,
  WaitingHeader,
  useThreadFilter,
} from "#client/threads/thread-panel.tsx";
import { BoardFrame } from "./board-frame.tsx";

/**
 * The board as a grid of frames in `order`. The body is one component so the
 * free canvas can replace it later; the sidebar and page shell stay.
 */
export function BoardPage(): React.JSX.Element {
  const { slug = "" } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  useLiveUpdates(slug);
  const board = useBoard(slug);
  const threads = useBoardThreads(slug);
  const create = useCreateThread();
  const [filter, setFilter] = useThreadFilter();
  const [loaded, setLoaded] = useState<readonly string[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const index = board.data?.index;
  const summaries = useMemo(() => {
    if (board.data === undefined) return [];
    const byId = new Map(
      board.data.artifacts.map((artifact) => [artifact.id, artifact]),
    );
    return board.data.index.order.flatMap((id) => {
      const summary = byId.get(id);
      const frame = board.data.index.frames[id];
      return summary === undefined || frame === undefined
        ? []
        : [{ summary, frame }];
    });
  }, [board.data]);

  const live = selectLiveFrames(
    summaries.map(({ summary }) => ({ id: summary.id, kind: summary.kind })),
    loaded,
  );
  const liveIds = summaries
    .filter(({ summary }) => live.has(summary.id))
    .map(({ summary }) => summary.id);
  const details = useArtifactDetails(liveIds);
  const detailById = new Map(
    liveIds.flatMap((id, position) => {
      const data = details[position]?.data;
      return data === undefined ? [] : [[id, data] as const];
    }),
  );

  useShortcuts([
    {
      key: "f",
      run: () => {
        if (selectedId !== null) void navigate(`/a/${selectedId}`);
      },
    },
    {
      key: "Enter",
      run: (event) => {
        if (selectedId === null || !live.has(selectedId)) return;
        event.preventDefault();
        setActiveId(selectedId);
      },
    },
    {
      key: "Escape",
      run: () => {
        setActiveId(null);
      },
    },
  ]);

  if (board.isError)
    return (
      <main className="ar-page" id="content" tabIndex={-1}>
        <h1>Board not found</h1>
        <p role="alert">{board.error.message}</p>
        <Link to="/">Back to the inbox</Link>
      </main>
    );
  if (index === undefined || board.data === undefined)
    return (
      <main className="ar-page" id="content" tabIndex={-1}>
        <p className="ar-empty" role="status">
          Loading…
        </p>
      </main>
    );

  // A board launched on one artifact opens on it; `?grid=1` shows the grid.
  const { launch } = index;
  if (
    launch.view === "focused" &&
    launch.artifactId !== undefined &&
    !params.has("grid")
  )
    return <Navigate replace to={`/a/${launch.artifactId}`} />;

  const boardThreads = (threads.data ?? []).filter(
    (thread) => thread.anchor.type === "board",
  );

  return (
    <main className="ar-board" id="content" tabIndex={-1}>
      <title>{`${board.data.board.title} · Artifacts`}</title>
      <header className="ar-board-head">
        <h1>{board.data.board.title}</h1>
        <span className="ar-grow" />
        <Link className="ui-btn" to={`/b/${slug}/outline`}>
          List view
        </Link>
      </header>
      <div className="ar-focus-body">
        <section className="ar-board-body" aria-label="Frames">
          {summaries.length === 0 ? (
            <p className="ar-empty">Nothing on this board yet.</p>
          ) : (
            <ul className="ar-grid" data-testid="board-grid">
              {summaries.map(({ summary, frame }) => (
                <BoardFrame
                  key={summary.id}
                  summary={summary}
                  detail={detailById.get(summary.id)}
                  live={live.has(summary.id)}
                  aspect={frame.w / frame.h}
                  active={activeId === summary.id}
                  selected={selectedId === summary.id}
                  onActiveChange={(on) => {
                    setActiveId(on ? summary.id : null);
                  }}
                  onSelect={setSelectedId}
                  onLoad={() => {
                    setLoaded((current) => [
                      ...current.filter((id) => id !== summary.id),
                      summary.id,
                    ]);
                  }}
                />
              ))}
            </ul>
          )}
        </section>
        <aside className="ar-sidebar" aria-label="Board threads">
          <WaitingHeader scope={{ type: "board", board: slug }} />
          <h2 className="ar-side-title">Board comments</h2>
          <ThreadList
            threads={boardThreads}
            filter={filter}
            onFilter={setFilter}
            selectedId={null}
            onSelect={noop}
            currentVersion={null}
            indexOf={() => null}
            empty="No board comments. Comments on a frame are on its full-size view."
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
        </aside>
      </div>
    </main>
  );
}
