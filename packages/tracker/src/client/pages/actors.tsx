import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router";
import { api } from "#client/data/api.ts";
import { Avatar, ErrorNotice } from "#client/ui/ui.tsx";
import { ActivityList } from "#client/issues/activity.tsx";
import { AbsoluteTime, RelativeTime } from "#client/ui/time.tsx";

export function Actors() {
  const key = useParams()["key"];
  const actors = useQuery({
    queryKey: ["actors"],
    queryFn: () => api.actors.list.query(),
  });
  const events = useQuery({
    queryKey: ["actor-events", key],
    queryFn: () => api.actors.activity.query({ actorKey: key, limit: 100 }),
    enabled: key !== undefined,
  });
  const actor = actors.data?.find((a) => a.key === key);
  const created = useQuery({
    queryKey: ["actor-created", key],
    queryFn: () =>
      api.issues.list.query({
        creatorKey: key,
        includeArchived: true,
        limit: "all",
      }),
    enabled: key !== undefined,
  });
  const votes = useQuery({
    queryKey: ["actor-votes", key],
    queryFn: () => api.actors.votes.query({ key: key ?? "" }),
    enabled: key !== undefined,
  });
  return (
    <div className="reading-page">
      {actors.error !== null && <ErrorNotice error={actors.error} />}
      {actor === undefined ? (
        <div className="actor-grid">
          {actors.data?.map((a) => (
            <Link
              className="actor-card"
              key={a.id}
              to={`/actors/${encodeURIComponent(a.key)}`}
            >
              <Avatar actor={a} decorative />
              <h2>{a.name}</h2>
              <span className="kind">{a.kind}</span>
              <code>{a.key}</code>
              <p>
                {a.seenCount} mutations · last seen{" "}
                <RelativeTime value={a.lastSeenAt} />
              </p>
            </Link>
          ))}
        </div>
      ) : (
        <>
          <div className="actor-profile">
            <Avatar actor={actor} decorative />
            <h2>{actor.name}</h2>
            <span className="kind">{actor.kind}</span>
            <code>{actor.key}</code>
            <p>
              First seen <AbsoluteTime value={actor.firstSeenAt} withTime /> ·{" "}
              {actor.seenCount} mutations
            </p>
          </div>
          <div className="metadata-grid">
            <section>
              <h3>First metadata</h3>
              <pre>{JSON.stringify(actor.firstMetadata, null, 2)}</pre>
            </section>
            <section>
              <h3>Latest metadata</h3>
              <pre>{JSON.stringify(actor.metadata, null, 2)}</pre>
            </section>
          </div>
          <section>
            <h3>Created issues</h3>
            {created.error !== null && <ErrorNotice error={created.error} />}
            {created.data?.items.map((issue) => (
              <p key={issue.id}>
                <Link to={`/issues/${issue.identifier}`}>
                  {issue.identifier} · {issue.title}
                </Link>
              </p>
            ))}
          </section>
          <section>
            <h3>Votes</h3>
            {votes.error !== null && <ErrorNotice error={votes.error} />}
            {votes.data?.map((vote) => (
              <p key={vote.identifier}>
                <Link to={`/issues/${vote.identifier}`}>
                  {vote.identifier} · {vote.title}
                </Link>
                {vote.note !== null && (
                  <span className="muted"> · {vote.note}</span>
                )}
              </p>
            ))}
          </section>
          {events.data !== undefined && (
            <ActivityList events={events.data} detailed />
          )}
        </>
      )}
    </div>
  );
}
