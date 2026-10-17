import { useQuery } from "@tanstack/react-query";
import { ReleaseListSchema } from "#shared/api.ts";
import type { MediaUser } from "#shared/contract.ts";
import { readApi } from "./api.ts";
import { ErrorNotice, Loading, Notice } from "./components.tsx";
import { IdentityReview } from "./acquisition-identity/review.tsx";
import type { DefaultTargetView } from "#shared/editions/target-view.ts";
import { useTargetCommand } from "./target-controls/mutation.ts";
import { CommandError, commandNeedsReview } from "./target-controls/errors.tsx";

export function ReleaseCandidates({
  user,
  mediaId,
  context,
}: {
  user: MediaUser;
  mediaId: string;
  context: DefaultTargetView;
}) {
  const releases = useQuery({
    queryKey: ["releases", mediaId],
    queryFn: async () =>
      readApi(
        `/media/${encodeURIComponent(mediaId)}/releases`,
        ReleaseListSchema,
      ),
  });
  const select = useTargetCommand(user.id);
  return (
    <section className="panel">
      <h2>Release decisions</h2>
      {releases.isPending && <Loading />}
      {releases.error !== null && <ErrorNotice error={releases.error} />}
      <CommandError
        error={select.error}
        review={() => {
          globalThis.location.reload();
        }}
      />
      {select.isSuccess && (
        <Notice>
          Release selection queued. Track its progress in Activity.
        </Notice>
      )}
      {releases.data?.length === 0 && (
        <p className="muted">
          No release candidates have been recorded yet. Search results and their
          matching decisions will appear here.
        </p>
      )}
      {releases.data?.map((release) => (
        <details className="release-details" key={release.id}>
          <summary>
            {release.title}
            <span className="helper"> {release.providerId}</span>
          </summary>
          {user.role === "owner" && (
            <IdentityReview
              user={user}
              mediaId={mediaId}
              releaseId={release.id}
              initialCoverage={release.attributes.mediaIds}
              context={context}
            />
          )}
          {user.role === "owner" &&
            release.attributes.identityConfidence === "exact" && (
              <button
                className="button"
                disabled={
                  select.isPending ||
                  select.isSuccess ||
                  commandNeedsReview(select.error)
                }
                onClick={() => {
                  select.submit({
                    context,
                    command: {
                      action: "select_release",
                      releaseId: release.id,
                    },
                  });
                }}
              >
                Select release
              </button>
            )}
          <details>
            <summary>Matching and quality evidence</summary>
            <pre>{JSON.stringify(release.evaluation, null, 2)}</pre>
            <h3>Release attributes</h3>
            <pre>{JSON.stringify(release.attributes, null, 2)}</pre>
          </details>
        </details>
      ))}
    </section>
  );
}
