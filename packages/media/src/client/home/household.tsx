import type { MediaUser } from "#shared/contract.ts";
import { LIBRARY_VIEW_NAMES } from "#shared/household/names.ts";
import { ReleaseList } from "#client/calendar/release.tsx";
import {
  entryTargetIds,
  entryTitle,
  leavingEntries,
} from "#client/library/keep-run.ts";
import {
  LeavingKeep,
  leavingPhase,
  type KeepRunControls,
} from "#client/library/leaving.tsx";
import type { LeavingTitle } from "#client/library/removals.ts";
import { libraryViewSearch } from "#client/library/view.ts";
import {
  kindAndYear,
  LEAVING_COPY,
  libraryStatePhrase,
  shortDate,
} from "#client/presentation/state-phrase.ts";
import { ListedTargets } from "#client/target-controls/listed.tsx";
import { classNames } from "#client/ui/class-names.ts";
import { PosterCard, StatePill } from "#client/ui/poster-card.tsx";
import { PosterRail } from "#client/ui/poster-rail.tsx";
import { PosterRailSkeleton } from "#client/ui/skeleton.tsx";
import {
  HomeSection,
  Item,
  ItemDetail,
  ItemPoster,
  Items,
  ItemsSkeleton,
  titleAddress,
} from "./frame.tsx";
import styles from "./home.module.css";
import {
  dayHeading,
  firstOfWeek,
  LEAVING_SHOWN,
  soonestEntries,
} from "./model.ts";
import {
  ADDED_VIEW,
  type HomeReads,
  type LibraryItem,
  type Read,
} from "./reads.ts";

const cx = classNames(styles);

/** What arrived in the library last, newest first, as a row of posters. */
export function NewInLibrary({ read }: { read: Read<LibraryItem> }) {
  const title = "New in the library";
  return (
    <HomeSection
      title={title}
      what="What is new in the library"
      link={{
        to: { pathname: "/library", search: libraryViewSearch(ADDED_VIEW) },
        text: "See all",
        label: `See all: ${title}`,
      }}
      read={read}
      count={read.items.length}
      skeleton={<PosterRailSkeleton label="Loading what is new" />}
      inRail
    >
      <PosterRail label={title}>
        {read.items.map((item) => (
          <li key={item.id}>
            <PosterCard
              to={titleAddress(item.id)}
              title={item.title}
              detail={kindAndYear(item.kind, item.year)}
              note={
                item.addedAt === null
                  ? null
                  : `Added ${shortDate(item.addedAt)}`
              }
              posterPath={item.artwork.posterPath}
              state={libraryStatePhrase(item)}
              headingLevel={3}
              layout="rail"
            />
          </li>
        ))}
      </PosterRail>
    </HomeSection>
  );
}

/** The calendar has every release; Home shows the first of the week. */
const WEEK_SHOWN = 12;

/**
 * What comes out in the next seven days for titles the household has or
 * follows, a day to a column. Each day's releases are the Calendar's own
 * rows (`calendar/release.tsx`), so a release reads the same on both pages.
 */
export function ThisWeek({ read }: { read: HomeReads["week"] }) {
  const { days, more } = firstOfWeek(read.items, WEEK_SHOWN);
  return (
    <HomeSection
      title="This week"
      what="This week’s releases"
      link={{
        to: "/calendar",
        text: "See all",
        label: "See all: the calendar",
      }}
      read={read}
      count={days.length}
      skeleton={<ItemsSkeleton label="Loading this week" count={3} />}
    >
      <div className={cx("week")}>
        {days.map((day) => {
          const heading = dayHeading(day.date, read.today);
          return (
            <div className={cx("day")} key={day.date}>
              <h3 className={cx("dayName")}>
                <time dateTime={day.date}>{heading.name}</time>
                {heading.date !== null && (
                  <span className={cx("dayDate")}>{heading.date}</span>
                )}
              </h3>
              <ReleaseList events={day.events} label={heading.name} />
            </div>
          );
        })}
      </div>
      {more > 0 && (
        <p className={cx("more")}>
          {more === 1
            ? "1 more release this week is on the calendar."
            : `${String(more)} more releases this week are on the calendar.`}
        </p>
      )}
    </HomeSection>
  );
}

/**
 * The titles that leave soonest, each with the one thing to do about it:
 * keep it for another 30 days, with the control the Library's own view has.
 * `keep` holds the "keep all" runs, which the page keeps so that a run's
 * report stays when its title has left the list.
 */
export function LeavingSoon({
  user,
  read,
  keep,
}: {
  user: MediaUser;
  read: Read<LeavingTitle>;
  keep: KeepRunControls;
}) {
  const title = LIBRARY_VIEW_NAMES.leaving;
  const entries = soonestEntries(leavingEntries(read.items, keep.runs));
  const total = read.items.length;
  const seeAll = total > LEAVING_SHOWN ? `See all ${String(total)}` : "See all";
  return (
    <HomeSection
      title={title}
      what="What is leaving"
      link={{
        to: "/library/leaving",
        text: seeAll,
        label: `${seeAll}: ${title}`,
      }}
      read={read}
      count={entries.length}
      skeleton={
        <ItemsSkeleton label="Loading what is leaving" count={LEAVING_SHOWN} />
      }
    >
      <ListedTargets mediaIds={entryTargetIds(entries)}>
        <Items label={title}>
          {entries.map((entry) => {
            const leaving = entryTitle(entry);
            return (
              <Item
                key={entry.rootMediaId}
                media={
                  <ItemPoster path={leaving.posterPath} title={leaving.name} />
                }
                title={leaving.name}
                to={titleAddress(leaving.rootMediaId)}
                action={
                  <LeavingKeep
                    user={user}
                    entry={entry}
                    onKeepAll={keep.keepAll}
                    onDismiss={() => {
                      keep.dismiss(entry.rootMediaId);
                    }}
                  />
                }
              >
                {entry.current === null ? (
                  <ItemDetail>None of it is leaving any more.</ItemDetail>
                ) : (
                  <p className={cx("itemState")}>
                    <StatePill
                      state={{
                        label: LEAVING_COPY[leavingPhase(entry.current)](
                          entry.current.leavesAt,
                        ),
                        tone: "warn",
                      }}
                    />
                  </p>
                )}
              </Item>
            );
          })}
        </Items>
      </ListedTargets>
    </HomeSection>
  );
}
