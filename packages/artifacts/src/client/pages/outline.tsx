import { noop } from "#client/lib/noop.ts";
import { Link, useParams } from "react-router";
import { useCreateThread } from "#client/data/mutations.ts";
import { useLiveUpdates } from "#client/data/live.ts";
import { useBoard, useBoardThreads } from "#client/data/queries.ts";
import { Composer } from "#client/threads/composer.tsx";
import { ThreadCard } from "#client/threads/thread-card.tsx";
import { WaitingHeader } from "#client/threads/thread-panel.tsx";
import { KIND_LABEL } from "./board-frame.tsx";

/**
 * The accessible way to review a board: frames and threads as one nested
 * list, every action a plain button or link in reading order.
 */
export function OutlinePage(): React.JSX.Element {
  const { slug = "" } = useParams();
  useLiveUpdates(slug);
  const board = useBoard(slug);
  const threads = useBoardThreads(slug);
  const create = useCreateThread();

  if (board.data === undefined)
    return (
      <main className="ar-page" id="content" tabIndex={-1}>
        <p className="ar-empty" role={board.isError ? "alert" : "status"}>
          {board.isError ? board.error.message : "Loading…"}
        </p>
      </main>
    );

  const { index, artifacts } = board.data;
  const byId = new Map(artifacts.map((artifact) => [artifact.id, artifact]));
  const all = threads.data ?? [];
  const boardLevel = all.filter((thread) => thread.artifactId === null);

  return (
    <main className="ar-page ar-outline" id="content" tabIndex={-1}>
      <title>{`${board.data.board.title} outline · Artifacts`}</title>
      <div className="ar-page-head">
        <h1>{board.data.board.title}</h1>
        <Link className="ui-btn" to={`/b/${slug}?grid=1`}>
          Visual board
        </Link>
      </div>
      <WaitingHeader scope={{ type: "board", board: slug }} />
      <ol className="ar-outline-list" aria-label="Frames">
        {index.order.flatMap((id) => {
          const artifact = byId.get(id);
          if (artifact === undefined) return [];
          const own = all.filter((thread) => thread.artifactId === id);
          return [
            <li
              key={id}
              className="ar-outline-item"
              data-testid="outline-frame"
            >
              <h2>
                <Link to={`/a/${id}`}>{artifact.title}</Link>
              </h2>
              <p className="ar-outline-meta">
                {KIND_LABEL[artifact.kind]}
                {artifact.currentVersion === null
                  ? ""
                  : ` · v${String(artifact.currentVersion.number)} by ${artifact.currentVersion.publisher.name}`}
                {` · ${String(own.filter((thread) => thread.state === "open").length)} open`}
              </p>
              {own.length === 0 ? null : (
                <ul
                  className="ar-threads"
                  aria-label={`Threads on ${artifact.title}`}
                >
                  {own.map((thread, position) => (
                    <ThreadCard
                      key={thread.id}
                      thread={thread}
                      index={position + 1}
                      selected={false}
                      currentVersion={artifact.currentVersion?.number ?? null}
                      onSelect={noop}
                    />
                  ))}
                </ul>
              )}
              <Composer
                label={`Comment on ${artifact.title}`}
                pending={create.isPending}
                onSubmit={(body) => {
                  create.mutate({
                    board: slug,
                    artifactId: id,
                    ...(artifact.currentVersion === null
                      ? {}
                      : { versionId: artifact.currentVersion.id }),
                    anchor: { type: "general" },
                    body,
                  });
                }}
              />
            </li>,
          ];
        })}
      </ol>
      <section aria-labelledby="board-comments">
        <h2 id="board-comments">Board comments</h2>
        {boardLevel.length === 0 ? (
          <p className="ar-empty">No board comments.</p>
        ) : (
          <ul className="ar-threads" aria-label="Board threads">
            {boardLevel.map((thread) => (
              <ThreadCard
                key={thread.id}
                thread={thread}
                index={null}
                selected={false}
                currentVersion={null}
                onSelect={noop}
              />
            ))}
          </ul>
        )}
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
      </section>
    </main>
  );
}
