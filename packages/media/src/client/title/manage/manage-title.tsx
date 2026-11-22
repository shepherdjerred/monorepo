import type { MediaDetail } from "#shared/api.ts";
import type { MediaUser } from "#shared/contract.ts";
import type { DefaultTargetView } from "#shared/editions/target-view.ts";
import { MediaProgress } from "#client/media-progress/panel.tsx";
import { MovieEditionControlsV4 } from "#client/movie-editions/target-controls-v4.tsx";
import { ReleaseCandidates } from "#client/releases/candidates.tsx";
import { classNames } from "#client/ui/class-names.ts";
import { ChangePanel } from "./change.tsx";
import { RecordedFiles } from "./files.tsx";
import { History } from "./history.tsx";
import { Standing } from "./standing.tsx";
import styles from "./manage.module.css";

const cx = classNames(styles);

/**
 * The Manage view of a title page: the owner's tools for one title, in the
 * order the owner asks about it. Where it stands, what is happening now, what
 * can be changed, what files it has, which releases were considered, and what
 * happened before. A member never downloads this module: the title page
 * imports it only when the owner opens the view.
 *
 * `paired` is false while the title's details and its command versions
 * disagree; controls that would send a command are inert until the page has
 * read both again.
 */
export function ManageTitle({
  user,
  media,
  context,
  paired,
}: {
  user: MediaUser;
  media: MediaDetail;
  context: DefaultTargetView;
  paired: boolean;
}) {
  const movie = media.kind === "movie";
  return (
    <div className={cx("page")}>
      <Standing user={user} media={media} id="standing" />
      <MediaProgress
        id="now"
        visibility={media.visibility}
        heading="What is happening now"
        description={
          movie
            ? "Whether the film can be watched, and the download and seeding of its unmarked edition."
            : "Whether the title can be watched, and the downloads and seeding behind it."
        }
      />
      <div inert={!paired}>
        <ChangePanel user={user} media={media} context={context} id="change" />
      </div>
      {movie && (
        <MovieEditionControlsV4
          key={media.id}
          user={user}
          mediaId={media.id}
          id="edition"
        />
      )}
      <RecordedFiles media={media} id="files" />
      {!movie && (
        <div inert={!paired}>
          <ReleaseCandidates
            key={media.id}
            user={user}
            mediaId={media.id}
            context={context}
            id="releases"
          />
        </div>
      )}
      <History media={media} id="history" />
    </div>
  );
}
