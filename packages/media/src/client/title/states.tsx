import { Link } from "react-router";
import { ApiError } from "#client/api.ts";
import { PageTitle } from "#client/components.tsx";
import { classNames } from "#client/ui/class-names.ts";
import skeletonStyles from "#client/ui/skeleton.module.css";
import { ErrorState } from "#client/ui/states.tsx";
import { BackLink } from "./back.tsx";
import styles from "./title.module.css";

const cx = classNames(styles);
const block = classNames(skeletonStyles)("block");

/**
 * The shape of a title page that is still loading: the hero's band, poster
 * and lines, then a few rows, in the space the page will take.
 */
export function TitleSkeleton() {
  return (
    <div role="status">
      <span className="sr-only">Loading title</span>
      <div className={cx("skeleton")} aria-hidden="true">
        <div className={`${block} ${cx("skeletonBand")}`} />
        <div className={cx("skeletonContent")}>
          <div className={`${block} ${cx("skeletonPoster")}`} />
          <div className={cx("skeletonLines")}>
            <div className={`${block} ${cx("skeletonTitle")}`} />
            <div className={`${block} ${cx("skeletonLine")}`} />
            <div className={`${block} ${cx("skeletonLine")}`} />
            <div className={`${block} ${cx("skeletonButton")}`} />
          </div>
        </div>
      </div>
    </div>
  );
}

/** The actions of a title whose standing is still being read. */
export function ActionsSkeleton() {
  return (
    <div role="status">
      <span className="sr-only">Loading what you can do</span>
      <div className={`${block} ${cx("skeletonButton")}`} aria-hidden="true" />
    </div>
  );
}

function WaysOut() {
  return (
    <div className={cx("waysOut")}>
      <Link className="button primary" to="/library">
        Go to the Library
      </Link>
      <Link className="button" to="/discover">
        Find something to watch
      </Link>
    </div>
  );
}

/** A title that does not exist, or no longer does. */
export function TitleNotFound() {
  return (
    <>
      <BackLink />
      <PageTitle title="This title is not here">
        <p>
          It may have been removed from the library, or the link may be out of
          date.
        </p>
      </PageTitle>
      <WaysOut />
    </>
  );
}

/** A title the reader may not open. */
function TitleNoAccess() {
  return (
    <>
      <BackLink />
      <PageTitle title="You cannot open this title">
        <p>
          Media shows a title to the people who can open it in Plex. If you
          think you should see this one, ask the library owner.
        </p>
      </PageTitle>
      <WaysOut />
    </>
  );
}

/**
 * A title page that could not be read, by what went wrong: the title is not
 * there, the reader may not open it, or the read itself failed and can be
 * tried again.
 */
export function TitleFailure({
  error,
  onRetry,
}: {
  error: Error;
  onRetry: () => void;
}) {
  if (error instanceof ApiError && error.status === 404) {
    return <TitleNotFound />;
  }
  if (error instanceof ApiError && error.status === 403) {
    return <TitleNoAccess />;
  }
  return (
    <>
      <BackLink />
      <PageTitle title="This title did not load" />
      <ErrorState error={error} what="The title’s details" onRetry={onRetry} />
    </>
  );
}
