import { useQuery } from "@tanstack/react-query";
import { api } from "#client/data/api.ts";
import { ErrorNotice } from "#client/ui/ui.tsx";
import { ActivityList } from "#client/issues/activity.tsx";

export function GlobalActivity() {
  const query = useQuery({
    queryKey: ["global-events"],
    queryFn: () => api.events.list.query({ limit: 100 }),
  });
  return (
    <div className="reading-page">
      {query.error !== null && <ErrorNotice error={query.error} />}
      {query.data === undefined ? (
        <div className="loading">Loading activity…</div>
      ) : (
        <ActivityList events={query.data} detailed />
      )}
    </div>
  );
}
