import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router";
import type { MediaUser } from "#shared/contract.ts";
import { movieEditionDisplayLabel } from "#shared/movie-editions/registry.ts";
import { dateLabel, PageTitle } from "#client/components.tsx";
import {
  isWaitingState,
  reviewStateCopy,
} from "#client/presentation/recovery.ts";
import {
  BackLink,
  Plain,
  StatusStack,
  TextLink,
} from "#client/recovery/parts.tsx";
import { recoveryPath } from "#client/recovery/paths.ts";
import { Badge, Callout, LoadError } from "#client/ui/feedback.tsx";
import { Panel, SkeletonRows } from "#client/ui/panel.tsx";
import {
  movieHistoryReviewViewV3,
  readMovieHistoryReviewV3,
  useMovieHistoryWriteV3,
  type MovieHistoryReviewV3,
} from "./api.ts";
import { movieHistoryPersonV3, movieHistorySubjectsV3 } from "./declaration.ts";
import { MovieHistoryCommandFeedbackV3 } from "./command-feedback.tsx";
import { MovieHistoryResponseFormV3 } from "./response.tsx";
import { MovieHistoryReleaseV3 } from "./release.tsx";

export function MovieHistoryPageV3({ user }: { user: MediaUser }) {
  const { id } = useParams();
  if (id === undefined)
    throw new Error("Movie history route requires a review");
  return (
    <MovieHistoryReviewPageV3 key={`${user.id}:${id}`} user={user} id={id} />
  );
}

/** What the review waits for, from where this reader stands. */
function standing(
  user: MediaUser,
  review: MovieHistoryReviewV3,
): { tone: "ok" | "warn" | "neutral"; title: string } {
  const view = movieHistoryReviewViewV3(review);
  if (view.kind === "personal") {
    return view.review.response === null
      ? { tone: "warn", title: "Your declaration is needed" }
      : { tone: "ok", title: "Your declaration is recorded" };
  }
  const owner = view.review;
  if (owner.receiptId !== null) {
    return { tone: "ok", title: "This edition’s history hold was released" };
  }
  const missing = owner.scope.users.filter((person) =>
    owner.missingUserIds.includes(person.id),
  );
  if (missing.length > 0) {
    return {
      tone: "warn",
      title: `Waiting for ${missing.map((person) => person.displayName).join(", ")}`,
    };
  }
  return user.role === "owner" && owner.scope.blockers.length === 0
    ? {
        tone: "ok",
        title: "Everyone has declared. It is ready for you to release.",
      }
    : { tone: "neutral", title: "Everyone has declared" };
}

function technicalRows(review: MovieHistoryReviewV3) {
  const view = movieHistoryReviewViewV3(review);
  if (view.kind !== "owner") return [];
  const owner = view.review;
  return [
    ["Review", owner.id],
    ["Version", String(owner.version)],
    ["Scope hash", owner.scopeHash],
    ["Response hash", owner.responseHash],
    ["Edition definition", owner.scope.definition.definitionDigest],
    ["Registry version", String(owner.scope.registryVersion)],
    ["Recovery epoch", String(owner.scope.recoveryEpoch)],
    ["Runtime version", String(owner.scope.runtimeVersion)],
    ["Receipt", owner.receiptId ?? "none"],
  ] as const;
}

function MovieHistoryReviewPageV3({
  user,
  id,
}: {
  user: MediaUser;
  id: string;
}) {
  const command = useMovieHistoryWriteV3();
  const result = useQuery({
    queryKey: ["movie-history", "review", user.id, id],
    queryFn: () => readMovieHistoryReviewV3(id),
    refetchInterval: 5000,
  });
  const review = result.data;
  if (review === undefined) {
    return (
      <>
        <PageTitle title="Movie edition review" />
        {result.error === null ? (
          <SkeletonRows label="Loading review" rows={3} />
        ) : (
          <LoadError
            what="This review"
            error={result.error}
            retry={() => {
              void result.refetch();
            }}
          />
        )}
      </>
    );
  }
  const view = movieHistoryReviewViewV3(review);
  const scope =
    view.kind === "owner" ? view.review.scope.scope : view.review.scope;
  const title =
    view.kind === "owner" ? view.review.scope.media.title : view.review.title;
  const closed =
    !isWaitingState(review.state) || Date.parse(review.expiresAt) <= Date.now();
  const subjects = movieHistorySubjectsV3(review, user);
  const state = reviewStateCopy(review.state);
  const where = standing(user, review);
  return (
    <>
      <PageTitle
        title={`${title} — ${movieEditionDisplayLabel(scope.edition)}`}
      >
        <p>
          This review records the chosen edition and present intent. It never
          reconstructs old requests or creates a Keep.
        </p>
      </PageTitle>
      <BackLink to={recoveryPath(user)}>All recovery reviews</BackLink>
      <StatusStack>
        {result.error !== null && (
          <LoadError
            what="The latest details"
            error={result.error}
            retry={() => {
              void result.refetch();
            }}
          />
        )}
        {closed && (
          <Callout tone="warn" title="This review is closed or expired">
            It cannot accept new declarations or release authority.
          </Callout>
        )}
        <Callout tone={where.tone} title={where.title}>
          A changed request, choice or Keep requires the owner to capture a
          fresh review. Positive declarations refer only to choices already
          captured here. Independent people declare for themselves.
        </Callout>
        <MovieHistoryCommandFeedbackV3 command={command} />
      </StatusStack>
      <Panel title="About this review">
        <Plain>
          <Badge tone={state.tone}>{state.label}</Badge> Expires{" "}
          {dateLabel(review.expiresAt)}.{" "}
          <TextLink to={`/media/${encodeURIComponent(scope.mediaId)}`}>
            Movie edition controls
          </TextLink>
        </Plain>
      </Panel>
      {subjects.map((subject) => (
        <MovieHistoryResponseFormV3
          key={`${review.id}:${String(review.version)}:${review.scopeHash}:${subject.id}`}
          user={user}
          person={movieHistoryPersonV3(review, subject)}
          command={command}
          closed={closed}
        />
      ))}
      {view.kind === "owner" && user.role === "owner" && !user.restricted && (
        <MovieHistoryReleaseV3
          key={`${review.id}:${String(review.version)}:${view.review.responseHash}`}
          user={user}
          review={view.review}
          command={command}
          closed={closed}
          technical={technicalRows(review)}
        />
      )}
    </>
  );
}
