import { useSearchParams } from "react-router";
import { z } from "zod";
import { PageTitle } from "#client/components.tsx";
import { classNames } from "#client/ui/class-names.ts";
import { Choice } from "#client/ui/choice.tsx";
import {
  LegacyActivitySourceSchema,
  legacyActivitySourceLabel,
} from "#shared/legacy-activity/contract.ts";
import { useUser } from "#client/shell/user.ts";
import { ActivityTimeline } from "./activity-timeline.tsx";
import styles from "./activity.module.css";

const cx = classNames(styles);
const sources = [
  "all",
  "media",
  "imported",
  ...LegacyActivitySourceSchema.options,
] as const;
const ActivitySourceSchema = z.enum(sources);

function ownerActivitySource(search: URLSearchParams) {
  const source = ActivitySourceSchema.safeParse(search.get("source"));
  return source.success ? source.data : "all";
}

export function ActivityPage() {
  const user = useUser();
  const [params, setParams] = useSearchParams();
  const selection =
    user.role === "owner" ? ownerActivitySource(params) : "media";
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
            resting="all"
            values={sources}
            labels={{
              all: "All activity",
              media: "Media activity",
              imported: "All imported activity",
              ...legacyActivitySourceLabel,
            }}
            onChange={(source) => {
              setParams(source === "all" ? {} : { source });
            }}
          />
        </div>
      )}
      <ActivityTimeline source={selection} />
    </>
  );
}
