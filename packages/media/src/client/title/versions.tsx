import { useQueries, useQuery } from "@tanstack/react-query";
import type { MediaDetail } from "#shared/api.ts";
import type { MediaUser } from "#shared/contract.ts";
import type { MovieTargetContextV4 } from "#shared/movie-editions/lifecycle/public-v4.ts";
import { MovieEditionKeySchema } from "#shared/movie-editions/registry.ts";
import { movieEditionReason } from "#client/movie-editions/presentation.ts";
import { readMovieContextV4 } from "#client/movie-editions/request-api-v4.ts";
import { readMovieTargetV4 } from "#client/movie-editions/target-api-v4.ts";
import { AVAILABILITY_COPY } from "#client/presentation/availability.ts";
import {
  FULFILLMENT_COPY,
  VERSION_COPY,
} from "#client/presentation/version.ts";
import { classNames } from "#client/ui/class-names.ts";
import { StatePill } from "#client/ui/poster-card.tsx";
import { RowActions } from "./actions.tsx";
import { CommandFeedback, useVersionRunner } from "./commands.tsx";
import { fullDate } from "./copy.ts";
import { versionFacts } from "./facts.ts";
import { fileSummary } from "./files.tsx";
import styles from "./title.module.css";

const cx = classNames(styles);

type OwnRequest = MediaDetail["visibility"]["movieRequests"][number];

/** The versions of a film the household has or has asked for. */
type MovieVersions = {
  /** The standard version, which the head of the page is about. */
  standard: MovieTargetContextV4 | undefined;
  /** Every version, the standard one first, once each has been read. */
  all: readonly MovieTargetContextV4[];
  error: Error | null;
  retry: () => void;
};

/**
 * Reads which versions of a film exist for this reader, and each one's
 * standing. The standard version is read at once; the others follow when the
 * list of versions arrives.
 */
export function useMovieVersions(
  mediaId: string,
  user: MediaUser,
): MovieVersions {
  const choices = useQuery({
    queryKey: ["movie-edition-context", 4, mediaId, user.id],
    queryFn: () => readMovieContextV4(mediaId, user.id),
    refetchOnWindowFocus: false,
  });
  const editions = MovieEditionKeySchema.options.filter(
    (edition) =>
      edition === "default" ||
      choices.data?.options.some(
        (option) =>
          option.edition === edition &&
          (option.storedDefinition !== null || option.request !== null),
      ) === true,
  );
  const targets = useQueries({
    queries: editions.map((edition) => ({
      queryKey: ["movie-target", 4, mediaId, edition],
      queryFn: () => readMovieTargetV4(mediaId, edition),
      refetchInterval: 15_000,
    })),
  });
  const all = targets.flatMap((target) =>
    target.data === undefined ? [] : [target.data],
  );
  return {
    standard: all.find((version) => version.scope.edition === "default"),
    all,
    error:
      choices.error ??
      targets.find((target) => target.error !== null)?.error ??
      null,
    retry: () => {
      void choices.refetch();
      for (const target of targets) void target.refetch();
    },
  };
}

/** Where the reader's own request for this version stands, as a sentence. */
function requestLine(request: OwnRequest): string | null {
  const copy = FULFILLMENT_COPY[request.fulfillment.status];
  if (copy === null) return null;
  return request.fulfillment.status === "protected"
    ? `You asked for this. ${movieEditionReason(request.fulfillment.reason)}`
    : `You asked for this: ${copy.label.toLowerCase()}.`;
}

function holdLine(version: MovieTargetContextV4): string | null {
  const hold = version.ownHold;
  if (hold === null) return null;
  if (hold.isPin) return "You pinned it, so it never leaves.";
  return hold.until === null
    ? "You are keeping it for now."
    : `You keep it until ${fullDate(hold.until)}.`;
}

function Version({
  user,
  media,
  version,
}: {
  user: MediaUser;
  media: MediaDetail;
  version: MovieTargetContextV4;
}) {
  const runner = useVersionRunner(user, version);
  const { edition } = version.scope;
  const name = VERSION_COPY[edition];
  const facts = versionFacts(version, media, user);
  const request = media.visibility.movieRequests.find(
    (candidate) => candidate.edition === edition,
  );
  const lines = [
    request === undefined ? null : requestLine(request),
    holdLine(version),
  ].filter((line) => line !== null);
  const file =
    version.access === "detail" && version.currentAsset !== null
      ? fileSummary(version.currentAsset.properties)
      : [];
  return (
    <li className={cx("version")}>
      <div className={cx("versionHead")}>
        <h3 className={cx("versionName")}>{name}</h3>
        {facts.availability !== null && (
          <StatePill state={AVAILABILITY_COPY[facts.availability]} />
        )}
        {/* The head of the page already acts on the standard version. */}
        {edition !== "default" && (
          <div className={cx("versionActions")}>
            <RowActions name={name} facts={facts} runner={runner} />
          </div>
        )}
      </div>
      {file.length > 0 && <p className={cx("quiet")}>{file.join(", ")}</p>}
      {lines.map((line) => (
        <p className={cx("versionLine")} key={line}>
          {line}
        </p>
      ))}
      <CommandFeedback runner={runner} />
    </li>
  );
}

/**
 * A film's versions, when it has more than one: what each is, where it
 * stands, and what the reader can do with it.
 */
export function VersionList({
  user,
  media,
  versions,
}: {
  user: MediaUser;
  media: MediaDetail;
  versions: readonly MovieTargetContextV4[];
}) {
  return (
    <ul className={cx("versions")}>
      {versions.map((version) => (
        <Version
          key={version.scope.edition}
          user={user}
          media={media}
          version={version}
        />
      ))}
    </ul>
  );
}
