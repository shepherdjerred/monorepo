import { useId } from "react";
import { FailureNotice } from "@shepherdjerred/streambot/web/client/failure-notice.tsx";
import {
  MediaRow,
  SkeletonRows,
} from "@shepherdjerred/streambot/web/client/media/media-row.tsx";
import { useRemote } from "@shepherdjerred/streambot/web/client/remote.tsx";
import { useSearch, type GroupKey, type GroupState } from "./use-search.ts";
import "@shepherdjerred/streambot/web/client/styles/search.css";

function Group(props: {
  title: string;
  state: GroupState | undefined;
  onRetry: () => void;
}) {
  const headingId = useId();
  const { state } = props;
  if (
    state === undefined ||
    (state.status === "loading" && state.items.length === 0)
  )
    return (
      <section aria-labelledby={headingId} aria-busy="true">
        <h2 id={headingId} className="group-heading">
          {props.title}
        </h2>
        <ul className="rows">
          <SkeletonRows count={2} />
        </ul>
      </section>
    );
  if (state.status === "failed")
    return (
      <section aria-labelledby={headingId}>
        <h2 id={headingId} className="group-heading">
          {props.title}
        </h2>
        <p className="status">
          <FailureNotice failure={state.failure} onRetry={props.onRetry} />
        </p>
      </section>
    );
  if (state.items.length === 0)
    return (
      <section className="group-empty" aria-labelledby={headingId}>
        <h2 id={headingId} className="group-heading">
          {props.title} <span className="group-note">· no matches</span>
        </h2>
      </section>
    );
  return (
    <section aria-labelledby={headingId} aria-busy={state.status === "loading"}>
      <h2 id={headingId} className="group-heading">
        {props.title}
        {state.status === "done" && state.correctedQuery !== undefined && (
          <span className="group-note">
            Showing results for “{state.correctedQuery}”
          </span>
        )}
      </h2>
      <ul className="rows">
        {state.items.map((item) => (
          <MediaRow key={item.key} item={item} />
        ))}
      </ul>
    </section>
  );
}

/** Search results for the query in the address bar, one independently loading group per kind. */
export function Results(props: { query: string }) {
  const remote = useRemote();
  const search = useSearch(
    props.query,
    remote.guildId,
    remote.room?.capabilities ?? null,
  );
  const pending = search.settled !== props.query.trim();
  return (
    <div className="results" data-row-scope="results" aria-busy={pending}>
      <h1 className="visually-hidden">Results for {props.query}</h1>
      {search.specs.map((spec) => (
        <Group
          key={spec.key}
          title={spec.title}
          state={search.groups[spec.key]}
          onRetry={() => {
            search.retry(spec.key satisfies GroupKey);
          }}
        />
      ))}
    </div>
  );
}
