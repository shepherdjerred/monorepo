import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { OperationListSchema } from "#shared/api.ts";
import { readApi } from "#client/api.ts";
import {
  dateLabel,
  EmptyState,
  ErrorNotice,
  humanize,
  Loading,
  PageTitle,
  Status,
} from "#client/components.tsx";
import { classNames } from "#client/ui/class-names.ts";
import styles from "./activity.module.css";

const cx = classNames(styles);

export function ActivityPage() {
  const activity = useQuery({
    queryKey: ["activity"],
    queryFn: async () => readApi("/activity", OperationListSchema),
    refetchInterval: 10_000,
  });
  return (
    <>
      <PageTitle title="Activity">
        <p>A clear view of what’s happening in your library.</p>
      </PageTitle>
      {activity.isPending && <Loading />}
      {activity.error !== null && <ErrorNotice error={activity.error} />}
      {activity.data?.length === 0 && (
        <EmptyState title="All quiet here">
          New requests, upgrades, and library changes will appear here.
        </EmptyState>
      )}
      <div className={cx("timeline")}>
        {activity.data?.map((operation) => (
          <article className={cx("timelineItem")} key={operation.id}>
            <span className={cx("timelineDot")} aria-hidden="true" />
            <div className={cx("itemMain")}>
              <h2>{humanize(operation.kind)}</h2>
              <p>{dateLabel(operation.updatedAt)}</p>
              {operation.mediaId !== null && (
                <Link
                  className="text-link"
                  to={`/media/${encodeURIComponent(operation.mediaId)}`}
                >
                  View title →
                </Link>
              )}
            </div>
            <Status value={operation.status} />
          </article>
        ))}
      </div>
    </>
  );
}
