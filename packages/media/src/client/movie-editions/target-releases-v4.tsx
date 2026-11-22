import { useQuery } from "@tanstack/react-query";
import type { MovieTargetContextV4 } from "#shared/movie-editions/lifecycle/public-v4.ts";
import { ReleaseListSchema } from "#shared/api.ts";
import { readApi } from "#client/api.ts";
import { ReleaseEvidence, ReleaseVerdict } from "#client/releases/evidence.tsx";
import { Button } from "#client/ui/button.tsx";
import { LoadError } from "#client/ui/feedback.tsx";
import {
  Disclosure,
  DisclosureList,
  EmptyNote,
  SkeletonRows,
} from "#client/ui/panel.tsx";
import type { MovieLifecycleControllerV4 } from "./target-api-v4.ts";
import styles from "./edition.module.css";
import { classNames } from "#client/ui/class-names.ts";

const cx = classNames(styles);

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
    <DisclosureList>
      <Disclosure title={`Choose a release for ${context.editionLabel}`}>
        <div className={cx("stack")}>
          <p className={cx("muted")}>
            Media checks the release against this exact edition and its current
            quality requirements before starting it.
          </p>
          {releases.isPending && (
            <SkeletonRows label="Loading releases" rows={2} />
          )}
          {releases.error !== null && (
            <LoadError
              what="Releases"
              error={releases.error}
              retry={() => {
                void releases.refetch();
              }}
            />
          )}
          {releases.data?.length === 0 && (
            <EmptyNote>No release candidates have been recorded yet.</EmptyNote>
          )}
          {releases.data !== undefined && releases.data.length > 0 && (
            <DisclosureList>
              {releases.data.map((release) => (
                <Disclosure
                  key={release.id}
                  title={release.title}
                  meta={
                    <>
                      <span>{release.providerId}</span>
                      <ReleaseVerdict release={release} />
                    </>
                  }
                >
                  <div className={cx("stack")}>
                    <ReleaseEvidence release={release} />
                    <div>
                      <Button
                        disabled={action.blocked || disabled}
                        onClick={() => {
                          action.submit(context, {
                            action: "select_release",
                            releaseId: release.id,
                          });
                        }}
                      >
                        Select for {context.editionLabel}
                      </Button>
                    </div>
                  </div>
                </Disclosure>
              ))}
            </DisclosureList>
          )}
        </div>
      </Disclosure>
    </DisclosureList>
  );
}
