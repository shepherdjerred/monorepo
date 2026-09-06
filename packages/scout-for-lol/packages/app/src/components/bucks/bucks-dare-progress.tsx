import { useInfiniteQuery } from "@tanstack/react-query";
import type { DarePollHealth, DareProgress } from "@scout-for-lol/data";
import { Button } from "@scout-for-lol/design-system/components/button";
import { ErrorState } from "@scout-for-lol/design-system/domain/states";
import { useTRPC } from "#src/lib/trpc.ts";

export function DareProgressPanel(props: { progress: DareProgress }) {
  return (
    <section className="space-y-3 rounded-lg border border-scout-border p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-medium">Progress</h2>
          <p className="text-sm text-scout-subtle">{props.progress.summary}</p>
        </div>
        <span className="text-xs text-scout-subtle">
          {props.progress.matchedGames.toString()} matched /{" "}
          {props.progress.eligibleGames.toString()} eligible
        </span>
      </div>
      <ul className="space-y-2">
        {props.progress.conditions.map((condition) => (
          <li
            key={condition.key}
            className="rounded-md bg-scout-surface px-3 py-2 text-sm"
          >
            <div className="flex flex-wrap justify-between gap-2">
              <span>{condition.label}</span>
              <span className="font-mono text-xs">
                {String(condition.current)} / {String(condition.target)}
              </span>
            </div>
            <p className="mt-1 text-xs text-scout-subtle">
              {condition.matchedGames.toString()} matched of{" "}
              {condition.eligibleGames.toString()} eligible
              {condition.unknownGames > 0
                ? ` · ${condition.unknownGames.toString()} incomplete`
                : ""}
            </p>
          </li>
        ))}
      </ul>
      {props.progress.coverageGaps.length > 0 && (
        <p className="text-xs text-scout-warning">
          {props.progress.coverageGaps.length.toString()} match
          {props.progress.coverageGaps.length === 1 ? " has" : "es have"}{" "}
          incomplete evidence and will not be treated as a failed condition.
        </p>
      )}
    </section>
  );
}

function formatOptionalDate(value: string | null): string {
  return value === null ? "not available" : new Date(value).toLocaleString();
}

export function DareProcessingHealthPanel(props: { health: DarePollHealth }) {
  return (
    <section className="space-y-2 rounded-lg border border-scout-border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-medium">Processing health</h2>
        <span className="rounded-full border border-scout-border px-2 py-0.5 text-xs">
          {props.health.status}
        </span>
      </div>
      <p className="text-xs text-scout-subtle">
        Last successful processing:{" "}
        {formatOptionalDate(props.health.lastSuccessfulProcessingAt)}
        {" · "}Evidence watermark:{" "}
        {formatOptionalDate(props.health.evidenceWatermarkAt)}
      </p>
      {props.health.incompleteReasons.map((reason) => (
        <p key={reason} className="text-xs text-scout-warning">
          {reason}
        </p>
      ))}
    </section>
  );
}

export function DareActivationHealthPanel(props: {
  health: {
    status: "pending" | "retrying" | "complete";
    requestedAt: string;
    attemptCount: number;
    lastAttemptAt: string | null;
    nextAttemptAt: string;
    errorCode: string | null;
    completedAt: string | null;
  } | null;
}) {
  if (props.health === null) return null;
  const detail =
    props.health.status === "complete"
      ? `Snapshot frozen ${new Date(props.health.completedAt ?? props.health.requestedAt).toLocaleString()}`
      : props.health.errorCode === null
        ? "Waiting for source coverage and a valid snapshot."
        : `${props.health.errorCode.replaceAll("_", " ")}; retrying ${new Date(props.health.nextAttemptAt).toLocaleString()}.`;
  return (
    <section className="rounded-md border border-scout-border bg-scout-surface p-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-medium">Activation snapshot</h2>
        <span className="capitalize">{props.health.status}</span>
      </div>
      <p className="mt-1 text-xs text-scout-subtle">{detail}</p>
      <p className="mt-1 text-xs text-scout-subtle">
        {props.health.attemptCount.toString()} attempt(s)
      </p>
    </section>
  );
}

export function DareEvidencePanel(props: {
  guildId: string;
  dareId: number;
  enabled: boolean;
}) {
  const trpc = useTRPC();
  const query = useInfiniteQuery(
    trpc.bucks.dareEvidence.infiniteQueryOptions(
      { guildId: props.guildId, dareId: props.dareId, limit: 10 },
      {
        enabled: props.enabled,
        getNextPageParam: (lastPage) => lastPage.nextCursor,
      },
    ),
  );
  if (!props.enabled) return null;
  if (query.isError) {
    return (
      <ErrorState
        message={query.error.message}
        onRetry={() => {
          void query.refetch();
        }}
      />
    );
  }
  const items = query.data?.pages.flatMap((page) => page.items) ?? [];
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-sm font-medium">Evaluated matches</h2>
        <p className="text-xs text-scout-subtle">
          Chronological evidence used by the frozen evaluator.
        </p>
      </div>
      <ol className="space-y-2">
        {items.map((item) => (
          <li key={item.matchId}>
            <details className="rounded-lg border border-scout-border p-3">
              <summary className="cursor-pointer text-sm">
                <span className="font-medium">{item.matchId}</span>
                <span className="ml-2 text-xs text-scout-subtle">
                  {item.queue} · {new Date(item.gameEndAt).toLocaleString()} ·{" "}
                  {item.coverageState.replaceAll("_", " ")}
                </span>
              </summary>
              <div className="mt-3 grid gap-3 lg:grid-cols-2">
                <EvidenceJson
                  label="Candidate sets and results"
                  value={{
                    candidates: item.candidateMembership,
                    results: item.setResults,
                    actualValues: item.actualValues,
                  }}
                />
                <EvidenceJson
                  label="Progress before and after"
                  value={{
                    before: item.progressBefore,
                    after: item.progressAfter,
                  }}
                />
                <EvidenceJson
                  label="Coverage and sources"
                  value={{
                    coverage: item.coverageState,
                    targets: item.targetDependencies,
                    sources: item.sourceReferences,
                  }}
                />
                <EvidenceJson
                  label="Evaluation trace"
                  value={item.evaluationTrace}
                />
              </div>
              <details className="mt-3">
                <summary className="cursor-pointer text-xs text-scout-subtle">
                  Raw evidence JSON
                </summary>
                <pre className="mt-2 max-h-96 overflow-auto rounded-md bg-scout-surface p-3 text-xs whitespace-pre-wrap">
                  {JSON.stringify(item.raw, null, 2)}
                </pre>
              </details>
            </details>
          </li>
        ))}
      </ol>
      {query.hasNextPage && (
        <Button
          type="button"
          variant="outline"
          disabled={query.isFetchingNextPage}
          onClick={() => {
            void query.fetchNextPage();
          }}
        >
          {query.isFetchingNextPage ? "Loading…" : "Load more evidence"}
        </Button>
      )}
    </section>
  );
}

function EvidenceJson(props: { label: string; value: unknown }) {
  return (
    <div className="min-w-0">
      <h3 className="text-xs font-medium">{props.label}</h3>
      <pre className="mt-1 max-h-64 overflow-auto rounded-md bg-scout-surface p-2 text-xs whitespace-pre-wrap">
        {formatDareEvidenceJson(props.value)}
      </pre>
    </div>
  );
}

export function formatDareEvidenceJson(value: unknown): string {
  const serialized = JSON.stringify(
    value,
    (key, current: unknown) => {
      if (
        typeof current === "number" &&
        (key === "skill_slot" || key === "skillSlot")
      ) {
        return ["Q", "W", "E", "R"][current - 1] ?? current;
      }
      return current;
    },
    2,
  );
  return serialized;
}
