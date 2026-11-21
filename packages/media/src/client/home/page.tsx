import { useState } from "react";
import { Link } from "react-router";
import type { MediaUser } from "#shared/contract.ts";
import { PageTitle } from "#client/components.tsx";
import { useKeepRuns } from "#client/library/leaving.tsx";
import { classNames } from "#client/ui/class-names.ts";
import { LeavingSoon, NewInLibrary, ThisWeek } from "./household.tsx";
import styles from "./home.module.css";
import {
  NeedsAnswer,
  NowPlaying,
  OnTheWay,
  type Answered,
} from "./personal.tsx";
import { useHomeReads } from "./reads.ts";

const cx = classNames(styles);

/**
 * Home when there is nothing to put on it: a household that has not asked
 * for anything yet, or a member on their first visit to one. It says what
 * the page is for and where to start.
 */
function Welcome({ user }: { user: MediaUser }) {
  return (
    <div className={cx("welcome")}>
      <h2 className={cx("welcomeTitle")}>{`Welcome, ${user.displayName}`}</h2>
      <p className={cx("welcomeBody")}>
        Nothing here needs you yet. Once your household has films and series,
        this page shows what you asked for and how far along it is, what is new
        in the library, what comes out this week, and what is about to leave.
      </p>
      <p className={cx("welcomeBody")}>
        Start in Discover: every title there can be asked for, and it arrives in
        Plex when it is ready.
      </p>
      <div className={cx("welcomeActions")}>
        <Link className="button primary" to="/discover">
          Find something to watch
        </Link>
        <Link className="button" to="/library">
          Open the library
        </Link>
      </div>
    </div>
  );
}

/**
 * Home: what is waiting on the reader, and what is new for them. It is made
 * of six sections, each from its own read, and a section with nothing to say
 * is not on the page. When none has anything, the page is a welcome.
 *
 * "None has anything" is only known once every read has answered: the two
 * sections that hold no place while they load say nothing by being absent,
 * so the welcome waits for them as it does for the rest. A read that failed
 * is not an empty one, and shows its failure instead.
 */
export function HomePage({ user }: { user: MediaUser }) {
  const reads = useHomeReads(user);
  const [answered, setAnswered] = useState<Answered>(new Map());
  // Held here, above the sections: a "keep all" report must outlive the
  // rows it is about, and the welcome must not replace one.
  const keep = useKeepRuns(user);
  const sections = [
    reads.needs,
    reads.playing,
    reads.onTheWay,
    reads.added,
    reads.week,
    reads.leaving,
  ];
  const nothing =
    answered.size === 0 &&
    keep.runs.size === 0 &&
    reads.needs.checks.length + reads.needs.decisions.length === 0 &&
    [reads.playing, reads.onTheWay, reads.added, reads.week, reads.leaving]
      .map((read) => read.items.length)
      .every((count) => count === 0) &&
    sections.every((read) => !read.pending && read.error === null);
  return (
    <>
      <PageTitle title="Home">
        <p>What is waiting on you, and what is new in your household.</p>
      </PageTitle>
      {nothing ? (
        <Welcome user={user} />
      ) : (
        <div className={cx("sections")}>
          <NeedsAnswer
            user={user}
            read={reads.needs}
            answered={answered}
            onAnswered={(check, action) => {
              setAnswered((current) =>
                new Map(current).set(check.interest.requestId, {
                  check,
                  action,
                }),
              );
            }}
          />
          <NowPlaying user={user} read={reads.playing} />
          <OnTheWay read={reads.onTheWay} />
          <NewInLibrary read={reads.added} />
          <ThisWeek read={reads.week} />
          <LeavingSoon user={user} read={reads.leaving} keep={keep} />
        </div>
      )}
    </>
  );
}
