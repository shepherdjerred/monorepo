import type { MediaDetail } from "#shared/api.ts";
import type { MediaUser } from "#shared/contract.ts";
import { dateLabel } from "#client/components.tsx";
import { StatusBadge } from "#client/status/badge.tsx";
import { classNames } from "#client/ui/class-names.ts";
import { LoadError } from "#client/ui/feedback.tsx";
import { Panel } from "#client/ui/panel.tsx";
import { FactList } from "#client/ui/record.tsx";
import { useProfiles } from "./profile-form.tsx";
import styles from "./manage.module.css";

const cx = classNames(styles);

/**
 * Where the title stands in the library: whether it is available, whether it
 * is still being upgraded, which quality profile judges it, who asked for it,
 * and what protects it from removal or is removing it.
 */
export function Standing({
  user,
  media,
  id,
}: {
  user: MediaUser;
  media: MediaDetail;
  id: string;
}) {
  const movie = media.kind === "movie";
  // The server tells only an unrestricted owner which profile is assigned.
  // Anyone else would read a withheld profile as "Not assigned".
  const operator = !user.restricted;
  const profiles = useProfiles(operator);
  const profile = profiles.data?.find(
    (candidate) => candidate.id === media.intent?.profileId,
  );
  return (
    <Panel
      title="Where it stands"
      id={id}
      description={
        movie
          ? "These panels describe the unmarked edition, the film’s standard version. Other editions are under Change an edition."
          : undefined
      }
    >
      <FactList
        facts={[
          {
            term: "Availability",
            detail: <StatusBadge value={media.availability} />,
          },
          {
            term: "Upgrade monitoring",
            detail: media.intent?.monitoring === true ? "Active" : "Paused",
          },
          ...(operator
            ? [
                {
                  term: "Quality profile",
                  detail: profiles.isPending
                    ? "Loading…"
                    : (profile?.name ?? "Not assigned"),
                },
              ]
            : []),
          {
            term: "Requested by",
            detail:
              media.requests
                .map((request) => request.user.displayName)
                .join(", ") || "No active requesters",
          },
          ...(!movie && media.holds.length > 0
            ? [
                {
                  term: "Protection",
                  detail: (
                    <div className={cx("holds")}>
                      {media.holds.map((hold) => (
                        <p key={hold.id}>
                          {hold.isPin
                            ? "Pinned indefinitely"
                            : `Protected until ${dateLabel(hold.until)}`}
                        </p>
                      ))}
                    </div>
                  ),
                },
              ]
            : []),
          ...(!movie && media.retention.length > 0
            ? [
                {
                  term: "Removal",
                  detail: (
                    <div className={cx("holds")}>
                      {media.retention.map((decision) => (
                        <p className={cx("retention")} key={decision.id}>
                          <StatusBadge value={decision.state} />
                          {decision.state === "quarantined"
                            ? `Recoverable until ${dateLabel(decision.purgeAfter)}`
                            : `Removal: ${dateLabel(decision.graceUntil)}`}
                        </p>
                      ))}
                    </div>
                  ),
                },
              ]
            : []),
        ]}
      />
      {profiles.error !== null && (
        <LoadError
          what="Quality profiles"
          error={profiles.error}
          retry={() => {
            void profiles.refetch();
          }}
        />
      )}
    </Panel>
  );
}
