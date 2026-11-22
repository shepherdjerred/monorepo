import type { ReactNode } from "react";
import type { MediaDetail } from "#shared/api.ts";
import type { MediaUser } from "#shared/contract.ts";
import {
  INTEREST_ACTION_NAMES,
  LIBRARY_VIEW_NAMES,
} from "#shared/household/names.ts";
import { languageName } from "#client/request-sheet/languages.ts";
import { classNames } from "#client/ui/class-names.ts";
import { fullDate } from "./copy.ts";
import { leavingOf, ownInterest } from "./facts.ts";
import styles from "./title.module.css";

const cx = classNames(styles);

export type Fact = { term: string; detail: string };

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

/** Names as a sentence lists them: "You", "You and Sam", "You, Kids, and Sam". */
function listed(names: readonly string[], locale?: string): string {
  return new Intl.ListFormat(locale, { type: "conjunction" }).format(names);
}

/**
 * The reader as the list of followers names them: "You", or for a film
 * followed only in versions other than the standard one, "You (Final cut)".
 * Null when the reader does not follow the title.
 */
export function selfAsFollower(
  following: boolean,
  versions: readonly string[] = [],
): string | null {
  if (!following) return null;
  return versions.length === 0 ? "You" : `You (${versions.join(", ")})`;
}

/**
 * Who follows the title, by name, the reader first. Owner and member read
 * the same list; a reader it is withheld from is told nothing, which is not
 * the same as nobody following.
 *
 * The list is the film's or the series', and a season or an episode says so:
 * what the reader does with that one part is at the head of the page. It
 * counts a person once however many versions of a film they follow, so a
 * reader who follows a film only in another version is on it as "You";
 * `self` then names the version ("You (Final cut)").
 */
function followedBy(
  media: Pick<MediaDetail, "id" | "rootMediaId" | "followers">,
  self: string | null,
  locale?: string,
): Fact | null {
  if (media.followers === null) return null;
  const part = media.id !== media.rootMediaId;
  const listedSelf = media.followers.some((follower) => follower.me);
  const names = [
    ...(listedSelf ? [part ? "You" : (self ?? "You")] : []),
    ...(!listedSelf && !part && self !== null ? [self] : []),
    ...media.followers
      .filter((follower) => !follower.me)
      .map((follower) => follower.displayName),
  ];
  return {
    term: part ? "Series followed by" : "Followed by",
    detail: names.length === 0 ? "Nobody yet" : listed(names, locale),
  };
}

/**
 * How long the library keeps a title, as a film or series says it and as a
 * season or an episode does: theirs is their series'.
 */
const KEEPING_FACT = {
  keep: {
    title: "For good: it stays even when nobody follows it",
    part: "For good, with the rest of the series",
  },
  temporary: {
    title: "Just for now: it stays while someone follows it",
    part: "Just for now, with the rest of the series",
  },
  unclassified: {
    title: "Not decided yet: nobody follows it, and it is not kept for good",
    part: "Not decided yet, with the rest of the series",
  },
} as const satisfies Record<
  MediaDetail["policy"],
  { title: string; part: string }
>;

type Kept = Pick<MediaDetail, "requests" | "libraryKeeping">;

/**
 * Whose request keeps the title for good, when that and not the owner's
 * switch is what keeps it: "your request asks", "Sam’s request asks".
 */
function keptByRequest(
  media: Kept,
  user: MediaUser,
  locale?: string,
): string | null {
  if (media.libraryKeeping?.keepingPolicy === "keep") return null;
  const keepers = media.requests.filter(
    (request) => request.keepingPolicy === "keep",
  );
  const own = keepers.some((request) => request.userId === user.id);
  const others = unique(
    keepers
      .filter((request) => request.userId !== user.id)
      .map((request) => request.user.displayName),
  );
  if (own && others.length === 0) return "your request asks";
  if (!own && others.length === 1) return `${String(others[0])}’s request asks`;
  return keepers.length === 0
    ? null
    : `requests by ${listed([...(own ? ["you"] : []), ...others], locale)} ask`;
}

type Keeping = Kept & Pick<MediaDetail, "id" | "rootMediaId" | "policy">;

/** How long the library keeps the title, and why when a request decides it. */
function keeping(media: Keeping, user: MediaUser, locale?: string): Fact {
  const copy = KEEPING_FACT[media.policy];
  if (media.id !== media.rootMediaId) {
    return { term: "Keeping", detail: copy.part };
  }
  const reason =
    media.policy === "keep" ? keptByRequest(media, user, locale) : null;
  return {
    term: "Keeping",
    detail:
      reason === null ? copy.title : `For good, because ${reason} for that`,
  };
}

/**
 * What protects the title on top of how long the library keeps it: a 30-day
 * hold and the owner's pin, each under its own name. The read gives a member
 * only their own.
 */
function protections(
  media: Pick<MediaDetail, "holds">,
  locale?: string,
): Fact[] {
  const until = media.holds
    .flatMap((hold) => (hold.until === null ? [] : [hold.until]))
    .sort((left, right) => right.localeCompare(left))[0];
  return [
    ...(until === undefined
      ? []
      : [{ term: "30-day hold", detail: `Until ${fullDate(until, locale)}` }]),
    ...(media.holds.some((hold) => hold.isPin)
      ? [{ term: "Pin", detail: "Pinned, so it never leaves" }]
      : []),
  ];
}

function removal(
  media: Pick<MediaDetail, "retention" | "intent">,
  locale?: string,
): Fact | null {
  const leaving = leavingOf(media);
  if (leaving?.kind === "leaving") {
    return {
      term: "Leaving",
      detail:
        leaving.at === null
          ? "Soon, unless someone keeps it"
          : `${fullDate(leaving.at, locale)}, unless someone keeps it`,
    };
  }
  if (leaving?.kind === "recoverable") {
    return {
      term: "Removed",
      detail:
        leaving.until === null
          ? "It can still be restored"
          : `It can be restored until ${fullDate(leaving.until, locale)}`,
    };
  }
  const removedAt = media.intent?.intentionallyRemovedAt ?? null;
  return removedAt === null
    ? null
    : { term: "Removed", detail: fullDate(removedAt, locale) };
}

/**
 * What the household is doing with a title it has: who follows it, how long
 * the library keeps it, what holds it meanwhile, when it leaves, and the
 * subtitles the reader asked for.
 */
export function householdFacts(
  media: MediaDetail,
  user: MediaUser,
  self: string | null,
  locale?: string,
): Fact[] {
  const followers = followedBy(media, self, locale);
  const gone = removal(media, locale);
  const languages = unique(
    media.requests
      .filter((request) => request.userId === user.id)
      .flatMap((request) => request.subtitleLanguages),
  ).map((code) => languageName(code));
  return [
    ...(followers === null ? [] : [followers]),
    keeping(media, user, locale),
    ...protections(media, locale),
    ...(gone === null ? [] : [gone]),
    ...(languages.length === 0
      ? []
      : [{ term: "Your subtitles", detail: languages.join(", ") }]),
  ];
}

/** Why "Stop following" is not offered for a request that keeps its title. */
const KEEPING_REQUEST_NOTE = {
  owner: `Your request keeps this for good, so ${INTEREST_ACTION_NAMES.drop} is not offered. To let it go, first change the request to ${INTEREST_ACTION_NAMES.temporary} under ${LIBRARY_VIEW_NAMES.mine} in the Library.`,
  member: `Your request keeps this for good, so ${INTEREST_ACTION_NAMES.drop} is not offered. Only the owner can change how long it is kept.`,
} as const satisfies Record<MediaUser["role"], string>;

/** How the three ways of keeping a title relate, for the one who has all three. */
const KEEPING_NOTE =
  "Keeping is the library’s standing choice for this title. A 30-day hold and a pin protect it on top of that choice, and leave the choice as it is.";

/**
 * What the facts above do not say on their own: why a request that keeps the
 * title cannot simply be let go, and, for the owner, how the keeping switch,
 * the 30-day hold and the pin relate.
 */
export function householdNotes(
  media: Pick<
    MediaDetail,
    "id" | "rootMediaId" | "requests" | "libraryKeeping"
  >,
  user: MediaUser,
): string[] {
  const keeps = ownInterest(media, user)?.keepingPolicy === "keep";
  const switched =
    media.id === media.rootMediaId && media.libraryKeeping !== null;
  return [
    ...(keeps ? [KEEPING_REQUEST_NOTE[user.role]] : []),
    ...(switched ? [KEEPING_NOTE] : []),
  ];
}

/** A titled part of the page below the hero. */
export function Section({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className={cx("section")}>
      <h2 className={cx("sectionTitle")}>{title}</h2>
      {children}
    </section>
  );
}

/** A few facts side by side, each a small label over its value. */
export function Facts({ facts }: { facts: readonly Fact[] }) {
  return (
    <dl className={cx("facts")}>
      {facts.map((fact) => (
        <div key={fact.term}>
          <dt>{fact.term}</dt>
          <dd>{fact.detail}</dd>
        </div>
      ))}
    </dl>
  );
}
