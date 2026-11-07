import { useQuery } from "@tanstack/react-query";
import type { MovieTargetContextV4 } from "#shared/movie-editions/lifecycle/public-v4.ts";
import { ReleaseListSchema } from "#shared/api.ts";
import { readApi } from "#client/api.ts";
import { ErrorNotice, Loading } from "#client/components.tsx";
import type { MovieLifecycleControllerV4 } from "./target-api-v4.ts";

export function MovieReleaseCandidatesV4({
  context,
  action,
  disabled,
}: {
  context: Extract<MovieTargetContextV4, { access: "detail" }>;
  action: MovieLifecycleControllerV4;
  disabled: boolean;
}) {
  const releases = useQuery({
    queryKey: ["releases", context.scope.mediaId],
    queryFn: () =>
      readApi(
        `/media/${encodeURIComponent(context.scope.mediaId)}/releases`,
        ReleaseListSchema,
      ),
  });
  return (
    <details>
      <summary>Choose a release for {context.editionLabel}</summary>
      <p className="helper">
        Media checks the release against this exact edition and its current
        quality requirements before starting it.
      </p>
      {releases.isPending && <Loading />}
      {releases.error !== null && <ErrorNotice error={releases.error} />}
      {releases.data?.length === 0 && (
        <p>No release candidates have been recorded yet.</p>
      )}
      {releases.data?.map((release) => (
        <details className="release-details" key={release.id}>
          <summary>
            {release.title} <span className="helper">{release.providerId}</span>
          </summary>
          <button
            className="button"
            disabled={action.blocked || disabled}
            onClick={() => {
              action.submit(context, {
                action: "select_release",
                releaseId: release.id,
              });
            }}
          >
            Select for {context.editionLabel}
          </button>
        </details>
      ))}
    </details>
  );
}
