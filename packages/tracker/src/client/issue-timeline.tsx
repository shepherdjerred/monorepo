import type { EventData, IssueDetailData } from "./api.ts";
import { ActivityList } from "./activity.tsx";
import { Comment } from "./comment.tsx";

type Entry =
  | {
      kind: "comment";
      at: string;
      id: string;
      value: IssueDetailData["comments"][number];
    }
  | { kind: "event"; at: string; id: string; value: EventData };
export function IssueTimeline({
  issue,
  events,
  disabled,
}: {
  issue: IssueDetailData;
  events: EventData[];
  disabled: boolean;
}) {
  const entries: Entry[] = [
    ...issue.comments.map((value) => ({
      kind: "comment" as const,
      at: value.createdAt,
      id: value.id,
      value,
    })),
    ...events
      .filter(
        (event) => event.entityType !== "comment" || event.action !== "created",
      )
      .map((value) => ({
        kind: "event" as const,
        at: value.occurredAt,
        id: value.id,
        value,
      })),
  ];
  entries.sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
  return (
    <div className="comments">
      {entries.map((entry) =>
        entry.kind === "comment" ? (
          <Comment key={entry.id} comment={entry.value} disabled={disabled} />
        ) : (
          <ActivityList key={entry.id} events={[entry.value]} />
        ),
      )}
    </div>
  );
}
