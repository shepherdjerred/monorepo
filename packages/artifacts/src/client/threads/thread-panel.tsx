import { Tabs } from "@shepherdjerred/console-ui";
import { useState } from "react";
import type { ThreadView } from "@shepherdjerred/artifacts/procedures";
import { useWaiters, usePending } from "#client/data/queries.ts";
import { waitingLine } from "#client/lib/delivery.ts";
import { ThreadCard } from "./thread-card.tsx";

export type ThreadFilter = "open" | "resolved" | "all";

export function filterThreads(
  threads: readonly ThreadView[],
  filter: ThreadFilter,
): ThreadView[] {
  return filter === "all"
    ? [...threads]
    : threads.filter((thread) => thread.state === filter);
}

/** Who is waiting for feedback on this scope, or how much is queued with nobody to read it. */
export function WaitingHeader({
  scope,
}: {
  readonly scope:
    | { readonly type: "artifact"; readonly artifactId: string }
    | { readonly type: "board"; readonly board: string };
}): React.JSX.Element {
  const waiters = useWaiters(
    scope.type === "artifact"
      ? { artifactId: scope.artifactId }
      : { board: scope.board },
  );
  const pending = usePending(scope);
  const queued =
    (pending.data?.deliverable ?? 0) + (pending.data?.settling ?? 0);
  const line = waitingLine(waiters.data?.waiters ?? [], queued);
  const someone = (waiters.data?.waiters.length ?? 0) > 0;
  return (
    <p
      className="ar-waiting"
      data-waiting={someone}
      role="status"
      data-testid="waiting"
    >
      <span className="ar-dot" aria-hidden="true" />
      {line}
    </p>
  );
}

/**
 * The thread list with its Open / Resolved / All filter. Selection is lifted
 * to the page so the viewer's pins and this list stay in step.
 */
export function ThreadList({
  threads,
  filter,
  onFilter,
  selectedId,
  onSelect,
  currentVersion,
  viewedVersion,
  indexOf,
  onViewVersion,
  contextOf,
  empty,
}: {
  readonly threads: readonly ThreadView[];
  readonly filter: ThreadFilter;
  readonly onFilter: (filter: ThreadFilter) => void;
  readonly selectedId: string | null;
  readonly onSelect: (threadId: string) => void;
  readonly currentVersion: number | null;
  readonly viewedVersion?: number | null;
  readonly indexOf: (thread: ThreadView) => number | null;
  readonly onViewVersion?: ((number: number) => void) | undefined;
  /** Names the place of a thread when the list spans several artifacts. */
  readonly contextOf?: ((thread: ThreadView) => string | null) | undefined;
  readonly empty: string;
}): React.JSX.Element {
  const shown = filterThreads(threads, filter);
  const [open, resolved] = [
    threads.filter((thread) => thread.state === "open").length,
    threads.filter((thread) => thread.state === "resolved").length,
  ];
  return (
    <>
      <Tabs
        label="Threads"
        value={filter}
        onChange={onFilter}
        options={[
          { value: "open", label: "Open", count: open },
          { value: "resolved", label: "Resolved", count: resolved },
          { value: "all", label: "All", count: threads.length },
        ]}
      />
      {shown.length === 0 ? (
        <p className="ar-empty">{empty}</p>
      ) : (
        <ul className="ar-threads" aria-label="Threads">
          {shown.map((thread) => (
            <ThreadCard
              key={thread.id}
              thread={thread}
              index={indexOf(thread)}
              selected={thread.id === selectedId}
              currentVersion={currentVersion}
              viewedVersion={viewedVersion ?? currentVersion}
              context={contextOf?.(thread) ?? null}
              onSelect={onSelect}
              onViewVersion={onViewVersion}
            />
          ))}
        </ul>
      )}
    </>
  );
}

export function useThreadFilter() {
  return useState<ThreadFilter>("open");
}
