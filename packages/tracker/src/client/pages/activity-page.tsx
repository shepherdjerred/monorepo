import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router";
import { ArrowDownWideNarrow, ArrowUpNarrowWide } from "lucide-react";
import { z } from "zod";
import { api } from "#client/data/api.ts";
import { EnumPicker, type EnumOption } from "#client/controls/enum-picker.tsx";
import { ErrorNotice } from "#client/ui/ui.tsx";
import { ActivitySkeleton } from "#client/ui/skeleton.tsx";
import { ActivityList } from "#client/issues/activity.tsx";

const ActivitySortSchema = z.enum(["newest", "oldest"]);
type ActivitySort = z.infer<typeof ActivitySortSchema>;

const activitySortOptions: (EnumOption & { value: ActivitySort })[] = [
  {
    value: "newest",
    label: "Newest first",
    icon: <ArrowDownWideNarrow size={14} />,
  },
  {
    value: "oldest",
    label: "Oldest first",
    icon: <ArrowUpNarrowWide size={14} />,
  },
];

export function GlobalActivity() {
  const [params, setParams] = useSearchParams();
  const parsedSort = ActivitySortSchema.safeParse(params.get("sort"));
  const sort: ActivitySort = parsedSort.success ? parsedSort.data : "newest";
  const query = useQuery({
    queryKey: ["global-events"],
    queryFn: () => api.events.list.query({ limit: 100 }),
  });
  const events = useMemo(() => {
    if (query.data === undefined) {
      return;
    }
    return sort === "newest" ? query.data : [...query.data].reverse();
  }, [query.data, sort]);

  return (
    <div className="reading-page">
      <div className="collection-toolbar">
        <span className="muted">Latest 100 workspace events</span>
        <span className="spacer" />
        <EnumPicker
          id="activity-sort"
          label="Sort activity"
          value={sort}
          options={activitySortOptions}
          onChange={(value) => {
            const nextSort = ActivitySortSchema.parse(value);
            const next = new URLSearchParams(params);
            if (nextSort === "newest") {
              next.delete("sort");
            } else {
              next.set("sort", nextSort);
            }
            setParams(next, { preventScrollReset: true });
          }}
        />
      </div>
      {query.error !== null && <ErrorNotice error={query.error} />}
      {events === undefined ? (
        <ActivitySkeleton />
      ) : (
        <ActivityList events={events} detailed />
      )}
    </div>
  );
}
