import { ShieldCheckIcon } from "lucide-react";
import { Link } from "react-router";
import type { MediaUser } from "#shared/contract.ts";
import type { RequestInterestCommand } from "#shared/household/interests.ts";
import { ErrorNotice } from "#client/components.tsx";
import {
  InterestAnswers,
  useInterestChange,
} from "#client/household/interests.tsx";
import { INTEREST_DONE_COPY } from "#client/presentation/interest.ts";
import {
  PLAYBACK_STATE_COPY,
  UNKNOWN_VIEWER,
} from "#client/presentation/now-playing.ts";
import { shortDate } from "#client/presentation/state-phrase.ts";
import { classNames } from "#client/ui/class-names.ts";
import { StatePill } from "#client/ui/poster-card.tsx";
import {
  HomeSection,
  Item,
  ItemDetail,
  ItemPoster,
  Items,
  ItemsSkeleton,
  sectionShown,
  titleAddress,
} from "./frame.tsx";
import styles from "./home.module.css";
import {
  byDeadline,
  playedOf,
  type InterestCheck,
  type OnTheWayTitle,
  type OwnerDecision,
} from "./model.ts";
import type { HomeReads, PlaybackSession, Read } from "./reads.ts";

const cx = classNames(styles);

type InterestAction = RequestInterestCommand["action"];

/**
 * The checks the reader answered while Home was open, by request. An
 * answered check stays where it was as its own confirmation, instead of
 * vanishing under the pointer.
 */
export type Answered = ReadonlyMap<
  string,
  { check: InterestCheck; action: InterestAction }
>;

/** When the answer is due, or why no day has been set. */
function deadline(check: InterestCheck): string {
  const { replyBy, noticeDeliveryState } = check.interest;
  if (replyBy !== null) {
    return `Still watching? Answer by ${shortDate(replyBy)}. After that Media stops following it for you.`;
  }
  return noticeDeliveryState === "attention"
    ? "Still watching? Media could not get a reminder to you, so there is no day to answer by yet."
    : "Still watching? There is no day to answer by until a reminder has reached you.";
}

/**
 * Takes focus when it replaces the buttons the reader just used, which
 * would otherwise leave focus nowhere.
 */
function takeLostFocus(element: HTMLElement | null) {
  if (element !== null && document.activeElement === document.body) {
    element.focus({ preventScroll: true });
  }
}

function CheckItem({
  user,
  check,
  answer,
  onAnswered,
}: {
  user: MediaUser;
  check: InterestCheck;
  /** What the reader answered here, once they have. */
  answer: InterestAction | undefined;
  onAnswered: (check: InterestCheck, action: InterestAction) => void;
}) {
  const change = useInterestChange(user, check.interest, (action) => {
    onAnswered(check, action);
  });
  return (
    <Item
      media={<ItemPoster path={check.posterPath} title={check.name} />}
      title={check.name}
      to={titleAddress(check.rootMediaId)}
      {...(answer === undefined
        ? {
            action: (
              <>
                <div className={cx("answers")}>
                  <InterestAnswers
                    user={user}
                    interest={check.interest}
                    change={change}
                  />
                </div>
                {change.error !== null && <ErrorNotice error={change.error} />}
              </>
            ),
          }
        : {})}
    >
      {check.part !== null && <ItemDetail>{check.part}</ItemDetail>}
      {answer === undefined ? (
        <ItemDetail>{deadline(check)}</ItemDetail>
      ) : (
        <p
          className={cx("done")}
          role="status"
          tabIndex={-1}
          ref={takeLostFocus}
        >
          {INTEREST_DONE_COPY[answer]}
        </p>
      )}
    </Item>
  );
}

/** "Dune", "Dune and Alien", or "Dune, Alien, Heat, and 2 more". */
function named(titles: readonly string[]): string {
  const NAMED = 3;
  const more = titles.length - NAMED;
  return new Intl.ListFormat(undefined, { type: "conjunction" }).format(
    more > 0
      ? [...titles.slice(0, NAMED), `${String(more)} more`]
      : [...titles],
  );
}

/** The recovery read lists at most this many held titles. */
const HELD_LIMIT = 100;

function heldTitle(count: number): string {
  if (count >= HELD_LIMIT) {
    return `At least ${String(HELD_LIMIT)} titles are held after a restore`;
  }
  return count === 1
    ? "1 title is held after a restore"
    : `${String(count)} titles are held after a restore`;
}

function DecisionItem({ decision }: { decision: OwnerDecision }) {
  const mark = (
    <div className={cx("mark")}>
      <ShieldCheckIcon aria-hidden="true" />
    </div>
  );
  if (decision.kind === "held") {
    return (
      <Item
        media={mark}
        title={heldTitle(decision.count)}
        action={
          <Link className="button" to="/recovery">
            Review held titles
          </Link>
        }
      >
        <ItemDetail>
          They stay in the library until a household review says what everyone
          still wants.
        </ItemDetail>
      </Item>
    );
  }
  return (
    <Item
      media={mark}
      title="A household review is open"
      action={
        <Link
          className="button"
          to={`/recovery/${encodeURIComponent(decision.reviewId)}`}
        >
          Open the review
        </Link>
      }
    >
      <ItemDetail>
        {`${named(decision.titles)} ${
          decision.titles.length === 1 ? "stays" : "stay"
        } protected until everyone has answered and you apply the review.`}
      </ItemDetail>
    </Item>
  );
}

/**
 * What is waiting on the reader: their "still watching?" checks, with the
 * answers the Library's Mine view gives, and for the owner what a restore
 * left to decide, each with a link to the page that decides it.
 */
export function NeedsAnswer({
  user,
  read,
  answered,
  onAnswered,
}: {
  user: MediaUser;
  read: HomeReads["needs"];
  answered: Answered;
  onAnswered: (check: InterestCheck, action: InterestAction) => void;
}) {
  // An answered check keeps its place: it sorts as it did while it waited.
  const checks = [
    ...read.checks.filter((check) => !answered.has(check.interest.requestId)),
    ...[...answered.values()].map((entry) => entry.check),
  ].sort(byDeadline);
  const count = checks.length + read.decisions.length;
  // For most people nothing is waiting, so the section holds no place while
  // its reads are out: it is on the page once one of them brings something.
  if (!sectionShown(read, count, false)) return null;
  return (
    <div className={cx("attention")} data-waiting={count > 0}>
      <HomeSection
        title="Needs your answer"
        what="What needs your answer"
        read={read}
        count={count}
      >
        <Items label="Needs your answer" stacked>
          {checks.map((check) => (
            <CheckItem
              key={check.interest.requestId}
              user={user}
              check={check}
              answer={answered.get(check.interest.requestId)?.action}
              onAnswered={onAnswered}
            />
          ))}
          {read.decisions.map((decision) => (
            <DecisionItem
              key={decision.kind === "review" ? decision.reviewId : "held"}
              decision={decision}
            />
          ))}
        </Items>
      </HomeSection>
    </div>
  );
}

function PlayingItem({
  user,
  session,
}: {
  user: MediaUser;
  session: PlaybackSession;
}) {
  const name = session.seriesTitle ?? session.title;
  const viewer =
    session.userId === user.id ? null : (session.userName ?? UNKNOWN_VIEWER);
  return (
    <Item
      media={
        <ItemPoster
          path={session.media?.artwork.posterPath ?? null}
          title={name}
        />
      }
      title={name}
      {...(session.media === null
        ? {}
        : { to: titleAddress(session.media.rootMediaId) })}
    >
      {session.seriesTitle !== null && <ItemDetail>{session.title}</ItemDetail>}
      <ItemDetail>
        {viewer === null
          ? `On ${session.platform}`
          : `${viewer}, on ${session.platform}`}
      </ItemDetail>
      <div className={cx("played")}>
        <StatePill state={PLAYBACK_STATE_COPY[session.state]} />
        <progress
          className={cx("meter")}
          aria-label={`How far ${name} has played`}
          value={Math.min(session.progressMs, session.durationMs)}
          max={Math.max(1, session.durationMs)}
        />
        <span className={cx("playedText")}>
          {playedOf(session.progressMs, session.durationMs)}
        </span>
      </div>
    </Item>
  );
}

/**
 * What is playing from the library right now: the household's streams for
 * the owner, the reader's own for anyone else. A stream Media can match to
 * a title links to it. Most of the time nothing is playing, so the section
 * holds no place while its read is out.
 */
export function NowPlaying({
  user,
  read,
}: {
  user: MediaUser;
  read: Read<PlaybackSession>;
}) {
  return (
    <HomeSection
      title="Now playing"
      what="What is playing"
      read={read}
      count={read.items.length}
    >
      <Items label="Now playing">
        {read.items.map((session) => (
          <PlayingItem key={session.id} user={user} session={session} />
        ))}
      </Items>
    </HomeSection>
  );
}

/** The Library's Mine view has every request; Home shows the first few. */
const ON_THE_WAY_SHOWN = 6;

/** What the reader asked for that has not all arrived, and how far it is. */
export function OnTheWay({ read }: { read: Read<OnTheWayTitle> }) {
  return (
    <HomeSection
      title="On the way"
      what="What is on the way"
      link={{
        to: "/library/mine",
        text: "See all",
        label: "See all: everything you asked for",
      }}
      read={read}
      count={read.items.length}
      skeleton={<ItemsSkeleton label="Loading what is on the way" count={3} />}
    >
      <Items label="On the way">
        {read.items.slice(0, ON_THE_WAY_SHOWN).map((title) => (
          <Item
            key={title.rootMediaId}
            media={<ItemPoster path={title.posterPath} title={title.name} />}
            title={title.name}
            to={titleAddress(title.rootMediaId)}
          >
            <p className={cx("itemState")}>
              <StatePill state={title.stage} />
            </p>
            <ItemDetail>{title.detail}</ItemDetail>
          </Item>
        ))}
      </Items>
    </HomeSection>
  );
}
