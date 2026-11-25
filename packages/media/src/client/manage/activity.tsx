import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router";
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
import { Choice } from "#client/ui/choice.tsx";
import {
  LegacyActivityQuerySchema,
  LegacyActivitySourceSchema,
  legacyActivitySourceLabel,
} from "#shared/legacy-activity/contract.ts";
import { useUser } from "#client/shell/user.ts";
import { ImportedActivity } from "./imported-activity.tsx";
import styles from "./activity.module.css";

const cx = classNames(styles);
const sources = [
  "media",
  "imported",
  ...LegacyActivitySourceSchema.options,
] as const;

export function ActivityPage() {
  const user = useUser();
  const [params, setParams] = useSearchParams();
  const parsed = LegacyActivityQuerySchema.safeParse({
    source: params.get("source"),
  });
  const selection =
    user.role === "owner" && parsed.success ? parsed.data.source : "media";
  return (
    <>
      <PageTitle title="Activity">
        <p>A clear view of what’s happening in your library.</p>
      </PageTitle>
      {user.role === "owner" && (
        <div className={cx("sourceFilter")}>
          <Choice
            label="Activity source"
            value={selection}
            resting="media"
            values={sources}
            labels={{
              media: "Media activity",
              imported: "All imported activity",
              ...legacyActivitySourceLabel,
            }}
            onChange={(source) => {
              setParams(source === "media" ? {} : { source });
            }}
          />
        </div>
      )}
      {selection === "media" ? (
        <MediaActivity />
      ) : (
        <ImportedActivity source={selection} />
      )}
    </>
  );
}

function MediaActivity() {
  const activity = useQuery({
    queryKey: ["activity"],
    queryFn: async () => readApi("/activity", OperationListSchema),
    refetchInterval: 10_000,
  });
  return (
    <>
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
