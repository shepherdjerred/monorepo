import { useState } from "react";
import { Link } from "react-router";
import type { MediaUser } from "#shared/contract.ts";
import { InterestControls } from "#client/household/interests.tsx";
import { MovieRequestControls } from "#client/movie-editions/requests.tsx";
import { ImportedRequestSource } from "#client/personal-migration/source.tsx";
import { AVAILABILITY_COPY } from "#client/presentation/availability.ts";
import type { Copy } from "#client/presentation/copy.ts";
import {
  INTEREST_STATE_COPY,
  REQUEST_KEEPING_COPY,
} from "#client/presentation/interest.ts";
import {
  ASKED_FOR_COPY,
  MOVIE_FULFILLMENT_COPY,
  REQUEST_CANCELLED,
  subtitlesPhrase,
} from "#client/presentation/request.ts";
import { ListedTargets } from "#client/target-controls/listed.tsx";
import { RequestProtection } from "#client/target-controls/protection.tsx";
import { classNames } from "#client/ui/class-names.ts";
import { Poster } from "#client/ui/poster.tsx";
import { StatePill } from "#client/ui/poster-card.tsx";
import styles from "./library.module.css";
import {
  awaitsAnswer,
  type MineAsk,
  type MineTitle,
  type Request,
} from "./mine-model.ts";

const cx = classNames(styles);

function asked(request: Request): string {
  return ASKED_FOR_COPY[request.media.kind](request.media, {
    future: request.includeFutureEpisodes,
    specials: request.includeSpecials,
  });
}

/** What the ask is for: the request's own words, else the film's edition. */
function what(ask: MineAsk): string {
  const { request, movie, interest } = ask;
  if (movie?.access === "detail") {
    if (movie.fulfillment.status === "pending_choice") {
      return "The film, edition not chosen yet";
    }
    // The default edition is the film as released; only a named cut is
    // worth naming.
    return movie.scope.edition === "default"
      ? ASKED_FOR_COPY.movie()
      : `The film, ${movie.editionLabel}`;
  }
  if (movie !== null) return "Your film request";
  if (request !== null) return asked(request);
  if (interest !== null) return interest.title;
  throw new Error("An ask with nothing asked");
}

function stateOf(ask: MineAsk): Copy {
  const { request, movie, interest } = ask;
  if (request?.active === false || movie?.active === false) {
    return REQUEST_CANCELLED;
  }
  if (interest !== null && interest.interestState !== "following") {
    return INTEREST_STATE_COPY[interest.interestState];
  }
  if (movie !== null) return MOVIE_FULFILLMENT_COPY[movie.fulfillment.status];
  return request === null
    ? INTEREST_STATE_COPY.following
    : AVAILABILITY_COPY[request.media.availability];
}

function Ask({
  user,
  ask,
  subjectUserId,
  name,
  open,
}: {
  user: MediaUser;
  ask: MineAsk;
  subjectUserId: string;
  /** The title the ask belongs to, to tell one ask's controls from another's. */
  name: string;
  /** Whether the controls start open: something here wants an answer. */
  open: boolean;
}) {
  const { request, movie, interest, imported } = ask;
  const subtitles =
    request === null ? null : subtitlesPhrase(request.subtitleLanguages);
  return (
    <div className={cx("ask")}>
      <div className={cx("askHead")}>
        <p className={cx("askWhat")}>{what(ask)}</p>
        <StatePill state={stateOf(ask)} />
      </div>
      {ask.userId !== null && ask.userId !== user.id && (
        <p className={cx("rowDetail")}>
          Someone else in the household asked for this.
        </p>
      )}
      {interest !== null && (
        <p className={cx("rowDetail")}>
          {REQUEST_KEEPING_COPY[interest.keepingPolicy]}
        </p>
      )}
      {subtitles !== null && <p className={cx("rowDetail")}>{subtitles}</p>}
      {request?.media.catalogState === "pending" && (
        <p className={cx("rowDetail")}>
          Episode details are still arriving; what this covers fills in as they
          do.
        </p>
      )}
      {movie?.access === "protection_only" && (
        <p className={cx("rowDetail")}>
          You can manage this request, but the library’s details of the film are
          not open to you.
        </p>
      )}
      {imported !== null && (
        <ImportedRequestSource claim={imported} viewerUserId={user.id} />
      )}
      <details className={cx("askControls")} open={open ? true : undefined}>
        <summary>
          Manage this request<span className="sr-only"> for {name}</span>
        </summary>
        {interest !== null && (
          <InterestControls user={user} interest={interest} />
        )}
        {movie !== null && (
          <MovieRequestControls
            user={user}
            subjectUserId={subjectUserId}
            request={movie}
          />
        )}
        {movie === null &&
          request !== null &&
          request.media.kind !== "movie" && (
            <RequestProtection user={user} request={request} />
          )}
      </details>
    </div>
  );
}

/**
 * The seasons and episodes an ask fans out to. Each is its own request with
 * its own controls, read together only once the list is opened.
 */
function Covered({ user, title }: { user: MediaUser; title: MineTitle }) {
  // With no request for the title itself, its parts are all there is to see.
  const alone = title.asks.length === 0;
  const [open, setOpen] = useState(alone);
  const count = title.covered.length;
  const parts = `${String(count)} ${count === 1 ? "part" : "parts"} of ${title.name ?? "this title"}`;
  return (
    <details
      className={cx("partsList")}
      open={open}
      onToggle={(event) => {
        setOpen(event.currentTarget.open);
      }}
    >
      <summary>
        {alone
          ? `${parts} asked for`
          : `${parts} covered by ${title.asks.length === 1 ? "this request" : "these requests"}`}
      </summary>
      {open && (
        <ListedTargets mediaIds={title.covered.map((row) => row.mediaId)}>
          <ul>
            {title.covered.map((row) => (
              <li className={cx("part")} key={row.id}>
                <div>
                  <p className={cx("partName")}>{asked(row)}</p>
                  <p className={cx("entryState")}>
                    <StatePill
                      state={
                        row.active
                          ? AVAILABILITY_COPY[row.media.availability]
                          : REQUEST_CANCELLED
                      }
                    />
                  </p>
                </div>
                <RequestProtection user={user} request={row} />
              </li>
            ))}
          </ul>
        </ListedTargets>
      )}
    </details>
  );
}

/** Brings the entry an emailed link names into view, once, when it appears. */
function reveal(entry: HTMLLIElement | null) {
  if (entry === null) return;
  // After the router has restored the page's own scroll position.
  globalThis.requestAnimationFrame(() => {
    entry.scrollIntoView({ block: "center" });
    entry.querySelector("a")?.focus({ preventScroll: true });
  });
}

/** One film or series and everything asked of it. */
export function MineTitleEntry({
  user,
  title,
  subjectUserId,
  linkedRequestId,
}: {
  user: MediaUser;
  title: MineTitle;
  subjectUserId: string;
  /**
   * The request a reminder's link names. The entry that holds it is scrolled
   * to and marked, with that request's controls open.
   */
  linkedRequestId: string | null;
}) {
  const highlighted =
    linkedRequestId !== null &&
    title.asks.some((ask) => ask.requestId === linkedRequestId);
  return (
    <li
      className={cx("entry")}
      data-highlighted={highlighted}
      ref={highlighted ? reveal : undefined}
    >
      <div className={cx("entryPoster")}>
        <Poster
          path={title.posterPath}
          title={title.name ?? "Film"}
          sizes="72px"
        />
      </div>
      <div className={`${cx("entryBody")} ${cx("entryWide")}`}>
        <h2 className={cx("entryTitle")}>
          {title.name === null ? (
            "A film you asked for"
          ) : (
            <Link to={`/media/${encodeURIComponent(title.rootMediaId)}`}>
              {title.name}
            </Link>
          )}
        </h2>
        {title.needsAnswer && (
          <p className={cx("entryState")}>
            <StatePill state={{ label: "Still watching?", tone: "warn" }} />
          </p>
        )}
        {title.asks.map((ask) => (
          <Ask
            key={ask.requestId}
            user={user}
            ask={ask}
            subjectUserId={subjectUserId}
            name={title.name ?? "your film request"}
            open={
              awaitsAnswer(ask.interest) || ask.requestId === linkedRequestId
            }
          />
        ))}
        {title.covered.length > 0 && <Covered user={user} title={title} />}
      </div>
    </li>
  );
}
