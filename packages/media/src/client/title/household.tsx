import type { ReactNode } from "react";
import type { MediaDetail } from "#shared/api.ts";
import type { MediaUser } from "#shared/contract.ts";
import { languageName } from "#client/request-sheet/languages.ts";
import { classNames } from "#client/ui/class-names.ts";
import { fullDate } from "./copy.ts";
import { leavingOf } from "./facts.ts";
import styles from "./title.module.css";

const cx = classNames(styles);

export type Fact = { term: string; detail: string };

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

/**
 * Who follows the title. The owner reads every request; a member reads only
 * their own, so a member is told about themselves and nobody else.
 */
function followers(
  media: MediaDetail,
  user: MediaUser,
  self: string | null,
): string {
  if (user.role !== "owner") {
    return self ?? "You are not following this";
  }
  const others = unique(
    media.requests
      .filter((request) => request.userId !== user.id)
      .map((request) => request.user.displayName),
  );
  const names = self === null ? others : [self, ...others];
  return names.length === 0 ? "Nobody yet" : names.join(", ");
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

/** What is holding the title in the library, as far as this reader is told. */
function keeping(
  media: MediaDetail,
  user: MediaUser,
  locale?: string,
): string | null {
  // A pin is the owner's own hold, not the library's keeping policy.
  if (media.holds.some((hold) => hold.isPin)) {
    return "Pinned, so it never leaves";
  }
  const until = media.holds
    .flatMap((hold) => (hold.until === null ? [] : [hold.until]))
    .sort((left, right) => right.localeCompare(left))[0];
  if (until !== undefined) return `Kept until ${fullDate(until, locale)}`;
  if (media.requests.length === 0) return null;
  return user.role === "owner"
    ? "While someone follows it"
    : "While you follow it";
}

function removal(media: MediaDetail, locale?: string): Fact | null {
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
 * What the household is doing with a title it has: who follows it, what
 * keeps it, when it leaves, and the subtitles the reader asked for.
 */
export function householdFacts(
  media: MediaDetail,
  user: MediaUser,
  self: string | null,
  locale?: string,
): Fact[] {
  const kept = keeping(media, user, locale);
  const gone = removal(media, locale);
  const languages = unique(
    media.requests
      .filter((request) => request.userId === user.id)
      .flatMap((request) => request.subtitleLanguages),
  ).map((code) => languageName(code));
  return [
    { term: "Following", detail: followers(media, user, self) },
    ...(kept === null ? [] : [{ term: "Keeping", detail: kept }]),
    ...(gone === null ? [] : [gone]),
    ...(languages.length === 0
      ? []
      : [{ term: "Your subtitles", detail: languages.join(", ") }]),
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
