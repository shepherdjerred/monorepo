import { PageTitle } from "#client/components.tsx";
import { CapacityPanel } from "#client/capacity/panel.tsx";
import { MovieHistoryIndexV3 } from "#client/movie-history/index.tsx";
import { isWaitingState } from "#client/presentation/recovery.ts";
import { AuthorityPanel } from "#client/recovery/authority.tsx";
import { HeldTitlesPanel } from "#client/recovery/held-titles.tsx";
import { LegacyRequesterBindings } from "#client/recovery/legacy-bindings.tsx";
import { useRecoveryList } from "#client/recovery/reads.ts";
import { StatusStack } from "#client/recovery/parts.tsx";
import { ReviewsPanel } from "#client/recovery/reviews.tsx";
import { useUser } from "#client/shell/user.ts";
import { ButtonLink } from "#client/ui/button.tsx";
import { DataList, DataRow } from "#client/ui/data-list.tsx";
import { Callout, LoadError } from "#client/ui/feedback.tsx";
import { Panel, SkeletonRows } from "#client/ui/panel.tsx";

const NATIVE_JOBS = [
  {
    to: "/manage/recovery/native",
    title: "Library files",
    detail:
      "Reprove Media-published files after a database restore: prove again which files Media published.",
    action: "Reprove restored library files",
  },
  {
    to: "/manage/recovery/native/archives",
    title: "Upgrade archives",
    detail: "Files an upgrade archived and set aside.",
    action: "Review upgrade archives",
  },
  {
    to: "/manage/recovery/native/compensations",
    title: "Interrupted upgrades",
    detail: "Upgrades that stopped part-way and need a decision.",
    action: "Review interrupted upgrades",
  },
] as const;

/**
 * Everything a restore from backup or an interrupted upgrade leaves for the
 * owner, in the order it needs attention: what is waiting on people, what is
 * still held, then the file proofs and the read-only state of the system.
 */
export function ManageRecoveryPage() {
  const user = useUser();
  const owner = !user.restricted;
  const result = useRecoveryList();
  const data = result.data;
  const waiting =
    data?.reviews.filter((review) => isWaitingState(review.state)).length ?? 0;
  const held = data?.holds.length ?? 0;
  return (
    <>
      <PageTitle title="Recovery">
        <p>
          What to review after a restore from backup or an interrupted upgrade.
        </p>
      </PageTitle>
      {result.isPending && (
        <Panel title="Household reviews">
          <SkeletonRows label="Loading recovery reviews" rows={3} />
        </Panel>
      )}
      {result.error !== null && (
        <StatusStack>
          <LoadError
            what="Recovery reviews"
            error={result.error}
            retry={() => {
              void result.refetch();
            }}
          />
        </StatusStack>
      )}
      {data !== undefined && (
        <>
          <StatusStack>
            {waiting === 0 && held === 0 ? (
              <Callout tone="ok" title="All clear">
                No household review is waiting and no title is held. The file
                proofs and upgrades below have their own pages.
              </Callout>
            ) : (
              <Callout
                tone="warn"
                title={[
                  waiting > 0
                    ? `${String(waiting)} household ${waiting === 1 ? "review is" : "reviews are"} waiting for declarations`
                    : null,
                  held > 0
                    ? `${String(held)} ${held === 1 ? "title is" : "titles are"} held`
                    : null,
                ]
                  .filter((part) => part !== null)
                  .join(" and ")}
              >
                Held titles stay protected, and nothing is released, until a
                household review has everyone&rsquo;s declaration and you apply
                it.
              </Callout>
            )}
          </StatusStack>
          <ReviewsPanel user={user} reviews={data.reviews} />
          <HeldTitlesPanel user={user} holds={data.holds} />
        </>
      )}
      <MovieHistoryIndexV3 user={user} />
      {owner && <LegacyRequesterBindings user={user} />}
      <Panel
        title="Library files and upgrades"
        description="File proofs after a database restore, and upgrades that need you. Each has its own page."
      >
        <DataList label="File recovery jobs">
          {NATIVE_JOBS.map((job) => (
            <DataRow
              key={job.to}
              title={job.title}
              detail={job.detail}
              actions={<ButtonLink to={job.to}>{job.action}</ButtonLink>}
            />
          ))}
        </DataList>
      </Panel>
      {data?.authority != null && <AuthorityPanel authority={data.authority} />}
      <CapacityPanel user={user} />
    </>
  );
}
