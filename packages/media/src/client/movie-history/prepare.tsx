import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { z } from "zod";
import type { MediaUser } from "#shared/contract.ts";
import {
  movieEditionDisplayLabel,
  type MovieEditionScope,
} from "#shared/movie-editions/registry.ts";
import type { PrepareMovieHistoryV3Schema } from "#shared/movie-editions/history-review-v3.ts";
import { Before, Plain, TextLink } from "#client/recovery/parts.tsx";
import { movieReviewPath } from "#client/recovery/paths.ts";
import { classNames } from "#client/ui/class-names.ts";
import { Callout, LoadError } from "#client/ui/feedback.tsx";
import { CheckboxField } from "#client/ui/forms/field.tsx";
import { Form, FormFooter } from "#client/ui/forms/form.tsx";
import { Disclosure, DisclosureList, SkeletonRows } from "#client/ui/panel.tsx";
import {
  readMovieHistoryContextV3,
  useMovieHistoryWriteV3,
  type MovieHistoryWriteControllerV3,
} from "./api.ts";
import { MovieHistoryReviewList } from "./index.tsx";
import { MovieHistoryCommandFeedbackV3 } from "./command-feedback.tsx";
import styles from "./movie-history.module.css";

const cx = classNames(styles);

export function MovieHistoryPrepareV3({
  user,
  scope,
}: {
  user: MediaUser;
  scope: MovieEditionScope;
}) {
  return user.role === "owner" && !user.restricted ? (
    <MovieHistoryOwnerPrepareV3
      key={`${scope.mediaId}:${scope.edition}`}
      user={user}
      scope={scope}
    />
  ) : null;
}

function MovieHistoryOwnerPrepareV3({
  user,
  scope,
}: {
  user: MediaUser;
  scope: MovieEditionScope;
}) {
  const [open, setOpen] = useState(false);
  const command = useMovieHistoryWriteV3();
  const result = useQuery({
    queryKey: [
      "movie-history",
      "context",
      user.id,
      scope.mediaId,
      scope.edition,
    ],
    enabled: open,
    queryFn: () => readMovieHistoryContextV3(scope),
  });
  const context = result.data;
  const headingId = `history-${scope.mediaId}-${scope.edition}`;
  return (
    <DisclosureList>
      <Disclosure
        title={`Household history for ${movieEditionDisplayLabel(scope.edition)}`}
        titleId={headingId}
        open={open}
        onToggle={setOpen}
      >
        {open && (
          <>
            <Plain>
              Reviews of this edition that are waiting on the household:
            </Plain>
            <MovieHistoryReviewList user={user} scope={scope} />
            {result.isPending && (
              <SkeletonRows
                label="Loading what a review would capture"
                rows={1}
              />
            )}
            {result.error !== null && (
              <LoadError
                what="What a review would capture"
                error={result.error}
                retry={() => {
                  void result.refetch();
                }}
              />
            )}
            {context !== undefined && (
              <MovieHistoryCaptureFormV3
                key={`${String(context.expected.mediaVersion)}:${String(context.expected.targetVersion)}:${String(context.expected.holdVersion)}:${context.expected.definition.definitionDigest}`}
                user={user}
                context={context}
                command={command}
                headingId={headingId}
              />
            )}
            <MovieHistoryCommandFeedbackV3 command={command} />
            {command.data !== undefined && (
              <Callout tone="ok" title="Review captured">
                <TextLink to={movieReviewPath(command.data.recoveryReviewId)}>
                  Open the captured edition review
                </TextLink>
              </Callout>
            )}
          </>
        )}
      </Disclosure>
    </DisclosureList>
  );
}

function MovieHistoryCaptureFormV3({
  user,
  context,
  command,
  headingId,
}: {
  user: MediaUser;
  context: z.infer<typeof PrepareMovieHistoryV3Schema>;
  command: MovieHistoryWriteControllerV3;
  headingId: string;
}) {
  const done = command.isSuccess;
  return (
    <Form
      labelledBy={headingId}
      onSubmit={() => {
        if (!done && !command.blocked)
          command.submit({
            actorId: user.id,
            path: "/movie-history/reviews",
            body: context,
          });
      }}
    >
      <Plain>
        Capture a review after everyone has chosen this edition and applied any
        Keep or pin they want recorded. Classification and household monitoring
        do not create a personal request.
      </Plain>
      <fieldset disabled={command.blocked || done} className={cx("group")}>
        <CheckboxField
          name="asked"
          required
          requiredMessage="Confirm you asked each person to set their choice and Keep first."
          label="I asked each person to set their edition request and any Keep before this capture. Everyone will still declare their own present intent."
        />
        <Before>
          Capturing records the current requests, choices and Keep for this
          edition in one review. Each person then declares their own present
          intent; nothing is released by capturing.
        </Before>
        <FormFooter
          submitLabel="Capture this edition’s review"
          pendingLabel="Capturing review"
          pending={command.isPending}
        />
      </fieldset>
    </Form>
  );
}
