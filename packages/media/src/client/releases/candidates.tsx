import { useQuery } from "@tanstack/react-query";
import { ReleaseListSchema } from "#shared/api.ts";
import type { MediaUser } from "#shared/contract.ts";
import type { DefaultTargetView } from "#shared/editions/target-view.ts";
import { readApi } from "#client/api.ts";
import { IdentityReview } from "#client/acquisition-identity/review.tsx";
import {
  CommandError,
  commandNeedsReview,
} from "#client/target-controls/errors.tsx";
import { useTargetCommand } from "#client/target-controls/mutation.ts";
import { Button } from "#client/ui/button.tsx";
import { classNames } from "#client/ui/class-names.ts";
import { Callout, LoadError } from "#client/ui/feedback.tsx";
import {
  Disclosure,
  DisclosureList,
  EmptyNote,
  Panel,
  SkeletonRows,
} from "#client/ui/panel.tsx";
import { ReleaseEvidence, ReleaseVerdict } from "./evidence.tsx";
import styles from "./evidence.module.css";

const cx = classNames(styles);

/**
 * The releases Media found for a title and how it judged each. The owner can
 * review what a release contains and select one; Media checks the choice
 * before it starts the download.
 */
export function ReleaseCandidates({
  user,
  mediaId,
  context,
  id,
}: {
  user: MediaUser;
  mediaId: string;
  context: DefaultTargetView;
  id?: string;
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
    <Panel
      title="Releases and how they were judged"
      description="Every release Media has found for this title, with its verdict and the reasons behind it. The history below records when one was selected."
      {...(id === undefined ? {} : { id })}
    >
      {releases.isPending && <SkeletonRows label="Loading releases" />}
      {releases.error !== null && (
        <LoadError
          what="Releases"
          error={releases.error}
          retry={() => {
            void releases.refetch();
          }}
        />
      )}
      <CommandError
        error={select.error}
        review={() => {
          globalThis.location.reload();
        }}
      />
      {select.isSuccess && (
        <Callout tone="ok">
          Release selection queued. Track its progress in Activity.
        </Callout>
      )}
      {releases.data?.length === 0 && (
        <EmptyNote>
          No release candidates have been recorded yet. Search results and their
          matching decisions will appear here.
        </EmptyNote>
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
              <div className={cx("candidate")}>
                <ReleaseEvidence release={release} />
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
                    <div>
                      <Button
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
                      </Button>
                    </div>
                  )}
              </div>
            </Disclosure>
          ))}
        </DisclosureList>
      )}
    </Panel>
  );
}
