import { lazy, Suspense, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router";
import type { MediaDetail } from "#shared/api.ts";
import type { MediaUser } from "#shared/contract.ts";
import type { DefaultTargetView } from "#shared/editions/target-view.ts";
import type { MovieTargetContextV4 } from "#shared/movie-editions/lifecycle/public-v4.ts";
import { movieFulfillmentLabel } from "#client/movie-editions/presentation.ts";
import { runtimeLabel } from "#client/presentation/state-phrase.ts";
import { VERSION_COPY } from "#client/presentation/version.ts";
import type { SheetSubject } from "#client/request-sheet/form.ts";
import { classNames } from "#client/ui/class-names.ts";
import { Segmented } from "#client/ui/segmented.tsx";
import { RowsSkeleton } from "#client/ui/skeleton.tsx";
import { ErrorState } from "#client/ui/states.tsx";
import { TitleActionBar } from "./actions.tsx";
import { BackLink } from "./back.tsx";
import { useTelevisionRunner, useVersionRunner } from "./commands.tsx";
import { TITLE_KIND_COPY, downloadProgress, titleState } from "./copy.ts";
import { televisionFacts, versionFacts } from "./facts.ts";
import { Files } from "./files.tsx";
import { Hero } from "./hero.tsx";
import {
  Facts,
  Section,
  householdFacts,
  householdNotes,
  selfAsFollower,
  type Fact,
} from "./household.tsx";
import { useTitleRunner } from "./household-commands.ts";
import { EpisodeList, SeasonList, mediaPath, readMedia } from "./seasons.tsx";
import { ActionsSkeleton } from "./states.tsx";
import { VersionList, useMovieVersions } from "./versions.tsx";
import styles from "./title.module.css";

const cx = classNames(styles);

/** The owner's tools arrive only when the owner opens them. */
const ManageTitle = lazy(async () => {
  const { ManageTitle: Manage } = await import("./manage/manage-title.tsx");
  return { default: Manage };
});

type TitleProps = {
  user: MediaUser;
  media: MediaDetail;
  /** The versions commands are sent against, with full access to the title. */
  context: Extract<DefaultTargetView, { access: "detail" }>;
  onRefresh: () => void;
};

/** The series a season or an episode belongs to; undefined for a title itself. */
function useSeries(media: MediaDetail) {
  const part = media.rootMediaId !== media.id;
  const series = useQuery({
    queryKey: ["media", media.rootMediaId],
    enabled: part,
    queryFn: () => readMedia(media.rootMediaId),
  });
  return part
    ? { id: media.rootMediaId, title: series.data?.title }
    : undefined;
}

/** A season or episode links up to its series, and an episode to its season. */
function trailOf(
  media: MediaDetail,
  series: ReturnType<typeof useSeries>,
): ReactNode {
  if (series === undefined) return undefined;
  return (
    <>
      <Link to={mediaPath(series.id)}>{series.title ?? "The series"}</Link>
      {media.kind === "episode" &&
        media.parentId !== null &&
        media.seasonNumber !== null && (
          <Link to={mediaPath(media.parentId)}>
            Season {media.seasonNumber}
          </Link>
        )}
    </>
  );
}

function plural(count: number, one: string): string {
  return `${String(count)} ${count === 1 ? one : `${one}s`}`;
}

/**
 * What kind of thing the title is, when it is from, and for a film or an
 * episode how long it runs. A series and a season have no length of their own.
 */
function metaOf(media: MediaDetail): string[] {
  const year = media.year === null ? [] : [String(media.year)];
  const runtime =
    media.runtimeMinutes === null ? [] : [runtimeLabel(media.runtimeMinutes)];
  switch (media.kind) {
    case "movie": {
      return [TITLE_KIND_COPY.movie, ...year, ...runtime];
    }
    case "series": {
      return [
        TITLE_KIND_COPY.series,
        ...year,
        ...(media.children.length === 0
          ? []
          : [plural(media.children.length, "season")]),
      ];
    }
    case "season": {
      return [plural(media.children.length, "episode"), ...year];
    }
    case "episode": {
      return [
        ...(media.seasonNumber === null || media.episodeNumber === null
          ? [TITLE_KIND_COPY.episode]
          : [
              `Season ${String(media.seasonNumber)}, episode ${String(media.episodeNumber)}`,
            ]),
        ...year,
        ...runtime,
      ];
    }
  }
}

/** What a member needs to know while a title is on its way or changing. */
function Progress({ media }: { media: MediaDetail }) {
  const progress = downloadProgress(media.visibility);
  const { playback } = media.visibility;
  return (
    <>
      {media.catalogState === "pending" && (
        <p className={cx("notice")} role="status">
          Episode details are still loading. You can request this series now;
          its episodes are included as the catalog fills in.
        </p>
      )}
      {progress !== null && (
        <p className={cx("download")}>
          <progress max={1} value={progress} aria-label="Download progress" />
          {Math.floor(progress * 100)}% downloaded
        </p>
      )}
      {playback.playable && playback.upgradeInProgress && (
        <p className={cx("quiet")}>
          A better copy is on the way. This one keeps playing until it arrives.
        </p>
      )}
    </>
  );
}

/**
 * The frame every household title shares: the way back, the hero with its
 * actions, and for the owner the switch between the page a member sees and
 * the Manage view.
 */
function TitleFrame({
  user,
  media,
  context,
  onRefresh,
  series,
  actions,
  children,
}: TitleProps & {
  series: ReturnType<typeof useSeries>;
  actions: ReactNode;
  children: ReactNode;
}) {
  const [params] = useSearchParams();
  const owner = user.role === "owner";
  const managing = owner && params.get("view") === "manage";
  // The details and the command versions are two reads; when they disagree
  // the title changed between them and nothing may be sent until both agree.
  const paired = media.version === context.expected.mediaVersion;
  return (
    <>
      <BackLink />
      <Hero
        title={media.title}
        artwork={media.artwork}
        trail={trailOf(media, series)}
        meta={metaOf(media)}
        state={titleState(media)}
        overview={media.overview}
      >
        <Progress media={media} />
        {!paired && (
          <div className={cx("notice")} role="status">
            <p>
              This title changed while its details were loading. Refresh before
              choosing an action.
            </p>
            <button className="button" type="button" onClick={onRefresh}>
              Refresh title
            </button>
          </div>
        )}
        <div inert={!paired}>{actions}</div>
      </Hero>
      {owner && (
        <div className={cx("views")}>
          <Segmented
            label="Title views"
            marks="true"
            segments={[
              { to: { search: "" }, label: "Overview", current: !managing },
              {
                to: { search: "?view=manage" },
                label: "Manage",
                current: managing,
              },
            ]}
          />
        </div>
      )}
      {managing ? (
        <Suspense fallback={<RowsSkeleton label="Loading the owner’s tools" />}>
          <ManageTitle
            user={user}
            media={media}
            context={context}
            paired={paired}
          />
        </Suspense>
      ) : (
        children
      )}
    </>
  );
}

function Household({
  user,
  media,
  self,
  more = [],
}: {
  user: MediaUser;
  media: MediaDetail;
  /** The reader as a follower; null when they do not follow the title. */
  self: string | null;
  /** Facts only this kind of title has. */
  more?: readonly Fact[];
}) {
  return (
    <Section title="In your household">
      <Facts facts={[...householdFacts(media, user, self), ...more]} />
      {householdNotes(media, user).map((note) => (
        <p className={cx("householdNote")} key={note}>
          {note}
        </p>
      ))}
    </Section>
  );
}

function TelevisionTitle(props: TitleProps) {
  const { user, media, context } = props;
  const runner = useTitleRunner(
    user,
    media,
    useTelevisionRunner(user, context),
  );
  const series = useSeries(media);
  const facts = televisionFacts(media, context, user);
  // A season or episode is asked for by name: "Severance, Season 2".
  const title =
    series?.title === undefined
      ? media.title
      : `${series.title}, ${media.title}`;
  const target = { mediaId: media.id };
  const subject: SheetSubject =
    media.kind === "series"
      ? {
          kind: "series",
          title,
          target,
          seasons: media.children.flatMap((season) =>
            season.seasonNumber === null
              ? []
              : [
                  {
                    seasonNumber: season.seasonNumber,
                    title: season.title,
                    episodeCount: null,
                  },
                ],
          ),
        }
      : media.kind === "season"
        ? { kind: "season", seasonNumber: media.seasonNumber, title, target }
        : { kind: "episode", title, target };
  return (
    <TitleFrame
      {...props}
      series={series}
      actions={
        <TitleActionBar
          user={user}
          facts={facts}
          runner={runner}
          subject={subject}
          requestLabel={
            facts.following ? "Request for someone else" : "Request"
          }
        />
      }
    >
      <Household
        user={user}
        media={media}
        self={selfAsFollower(facts.following)}
      />
      {media.kind === "series" && media.children.length > 0 && (
        <Section title="Seasons">
          <SeasonList seasons={media.children} />
        </Section>
      )}
      {media.kind === "season" && (
        <Section title="Episodes">
          <EpisodeList
            label={`${media.title} episodes`}
            episodes={media.children}
          />
        </Section>
      )}
      <Files media={media} />
    </TitleFrame>
  );
}

/**
 * The reader as a follower of a film. Following the standard version is
 * following the film; any other version is named.
 */
function movieFollower(media: MediaDetail): string | null {
  const asked = media.visibility.movieRequests.map(
    (request) => request.edition,
  );
  return selfAsFollower(
    asked.length > 0,
    asked.includes("default")
      ? []
      : asked.map((edition) => VERSION_COPY[edition]),
  );
}

/**
 * What stands between the reader's request for a film and the film, when it
 * is something the reader should know: a version still to choose, or a
 * request that is on hold and why.
 */
function requestFacts(media: MediaDetail): Fact[] {
  return media.visibility.movieRequests
    .filter(
      ({ fulfillment }) =>
        fulfillment.status === "pending_choice" ||
        fulfillment.status === "protected",
    )
    .slice(0, 1)
    .map((request) => ({
      term: "Your request",
      detail: movieFulfillmentLabel(request.fulfillment),
    }));
}

/** A film's actions, once its standard version has been read. */
function MovieActions({
  user,
  media,
  version,
}: {
  user: MediaUser;
  media: MediaDetail;
  version: MovieTargetContextV4;
}) {
  const runner = useTitleRunner(user, media, useVersionRunner(user, version));
  const asked = media.visibility.movieRequests.length > 0;
  return (
    <TitleActionBar
      user={user}
      facts={versionFacts(version, media, user)}
      runner={runner}
      subject={{
        kind: "movie",
        title: media.title,
        target: { mediaId: media.id },
      }}
      requestLabel={asked ? "Request another version" : "Request"}
    />
  );
}

function MovieTitle(props: TitleProps) {
  const { user, media } = props;
  const versions = useMovieVersions(media.id, user);
  const { standard } = versions;
  let actions: ReactNode = <ActionsSkeleton />;
  if (standard !== undefined) {
    actions = <MovieActions user={user} media={media} version={standard} />;
  } else if (versions.error !== null) {
    actions = (
      <ErrorState
        error={versions.error}
        what="What you can do with this film"
        onRetry={versions.retry}
      />
    );
  }
  return (
    <TitleFrame {...props} series={undefined} actions={actions}>
      <Household
        user={user}
        media={media}
        self={movieFollower(media)}
        // With several versions, each lists its own request below.
        more={versions.all.length > 1 ? [] : requestFacts(media)}
      />
      {versions.all.length > 1 && (
        <Section title="Versions">
          <VersionList user={user} media={media} versions={versions.all} />
        </Section>
      )}
      <Files media={media} />
    </TitleFrame>
  );
}

/**
 * The page of a film, series, season or episode the household has. A film
 * is acted on one version at a time; everything else through the title
 * itself.
 */
export function LibraryTitle(props: TitleProps) {
  return props.media.kind === "movie" ? (
    <MovieTitle {...props} />
  ) : (
    <TelevisionTitle {...props} />
  );
}
