import { Loaded } from "@shepherdjerred/loaded";
import type { DareProgress } from "@scout-for-lol/data";
import {
  ErrorState,
  LoadingState,
  StaleState,
} from "@scout-for-lol/design-system/domain/states";
import { EmptyState } from "@scout-for-lol/design-system/layout";
import { DareStatePill as StatePill } from "#src/components/bucks-dare-display.tsx";

export type DareSummary = {
  id: number;
  state: string;
  plainLanguage: string;
  targetAliases: string[];
  potTotal: number;
  evidenceGames: number;
  updatedAt: string;
  progress: DareProgress;
  requiresViewerAction: boolean;
};

/**
 * `loading` and `error` used to arrive as separate props alongside `dares`,
 * so "failed" and "we already have a page" could both be true and the
 * component resolved it by discarding the page. One state cannot say both.
 */
export function DareList(props: {
  dares: Loaded<readonly DareSummary[]>;
  onRetry: () => void;
  onSelect: (dareId: number) => void;
}) {
  return Loaded.match(props.dares, {
    loading: () => <LoadingState label="Loading dares…" />,
    error: (errors) => (
      <ErrorState
        message={Loaded.messageOf(errors[0].error)}
        onRetry={props.onRetry}
      />
    ),
    available: (dares, meta) =>
      dares.length === 0 ? (
        <EmptyState>
          <h2>No dares match</h2>
          <p>Try another search or create a Dare in Explore.</p>
        </EmptyState>
      ) : (
        <>
          <StaleState errors={meta.errors} />
          <ul className="grid gap-3 lg:grid-cols-2">
            {dares.map((dare) => (
              <li key={dare.id}>
                <button
                  type="button"
                  className="h-full w-full space-y-3 rounded-lg border border-scout-border p-4 text-left hover:bg-scout-hover"
                  onClick={() => {
                    props.onSelect(dare.id);
                  }}
                >
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="font-medium">
                      Dare #{dare.id.toString()}
                    </span>
                    <StatePill state={dare.state} />
                  </div>
                  <p className="line-clamp-3 whitespace-pre-wrap text-sm">
                    {dare.plainLanguage}
                  </p>
                  <p className="text-xs text-scout-subtle">
                    {dare.targetAliases.join(", ")} · {dare.potTotal.toString()}{" "}
                    BB · {dare.evidenceGames.toString()} evidence games
                  </p>
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="text-scout-subtle">
                      {dare.progress.summary}
                    </span>
                    {dare.requiresViewerAction && (
                      <span className="rounded-full bg-scout-warning/15 px-2 py-0.5 text-scout-warning">
                        Needs action
                      </span>
                    )}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </>
      ),
  });
}
