import { useMutation, useQuery } from "@tanstack/react-query";
import { CommandResultSchema, ReleaseListSchema } from "#shared/api.ts";
import type { MediaUser } from "#shared/contract.ts";
import { queryClient, readApi, writeApi } from "./api.ts";
import { ErrorNotice, Loading, Notice } from "./components.tsx";
import { IdentityReview } from "./acquisition-identity/review.tsx";

export function ReleaseCandidates({
  user,
  mediaId,
  version,
}: {
  user: MediaUser;
  mediaId: string;
  version: number;
}) {
  const releases = useQuery({
    queryKey: ["releases", mediaId],
    queryFn: async () =>
      readApi(
        `/media/${encodeURIComponent(mediaId)}/releases`,
        ReleaseListSchema,
      ),
  });
  const select = useMutation({
    mutationFn: async (releaseId: string) =>
      writeApi({
        actorId: user.id,
        path: `/media/${encodeURIComponent(mediaId)}/actions`,
        body: { action: "select_release", expectedVersion: version, releaseId },
        schema: CommandResultSchema,
      }),
    onSuccess: async () =>
      queryClient.invalidateQueries({ queryKey: ["media", mediaId] }),
  });
  return (
    <section className="panel">
      <h2>Release decisions</h2>
      {releases.isPending && <Loading />}
      {releases.error !== null && <ErrorNotice error={releases.error} />}
      {select.error !== null && <ErrorNotice error={select.error} />}
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
            />
          )}
          {user.role === "owner" &&
            release.attributes.identityConfidence === "exact" && (
              <button
                className="button"
                disabled={select.isPending}
                onClick={() => {
                  select.mutate(release.id);
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
