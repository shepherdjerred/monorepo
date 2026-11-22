import type { ComponentProps, ReactNode } from "react";
import { Link, type To } from "react-router";
import { classNames } from "#client/ui/class-names.ts";
import { Poster } from "#client/ui/poster.tsx";
import { PosterRailStandIn } from "#client/ui/poster-rail.tsx";
import { Section } from "#client/ui/section.tsx";
import { SkeletonStatus } from "#client/ui/skeleton.tsx";
import skeletonStyles from "#client/ui/skeleton.module.css";
import { ErrorState } from "#client/ui/states.tsx";
import styles from "./home.module.css";
import type { ReadState } from "./reads.ts";

const cx = classNames(styles);
const shape = classNames(skeletonStyles);

/** Where a film or series has its page. */
export function titleAddress(mediaId: string): string {
  return `/media/${encodeURIComponent(mediaId)}`;
}

/**
 * Whether a section is on the page at all. One with something to show, or
 * a failure to report, always is. One still loading is only when it holds
 * its place: a section that is empty for most people does not, and appears
 * when its read brings something.
 */
export function sectionShown(
  read: ReadState,
  count: number,
  holdsPlace: boolean,
): boolean {
  return count > 0 || read.error !== null || (read.pending && holdsPlace);
}

/**
 * One section of Home, in whichever state its read is in:
 *
 * - still loading: the heading over `skeleton`, which takes the room the
 *   content will, or nothing at all for a section given no skeleton;
 * - failed with nothing to show: the heading over what went wrong, with a
 *   way to ask again, and the other sections untouched;
 * - answered with nothing: no section at all, not an empty heading;
 * - otherwise the heading, the link to all of it, and `children`.
 */
export function HomeSection({
  title,
  what,
  link,
  read,
  count,
  skeleton,
  inRail = false,
  children,
}: {
  title: string;
  /** The section's content as the start of a sentence, for its failure. */
  what: string;
  link?: ComponentProps<typeof Section>["link"];
  read: ReadState;
  /** How many things the section has to show. */
  count: number;
  /**
   * What holds the section's place while it loads. Left out for a section
   * that usually has nothing: a heading that came and went on every visit
   * would say something was there.
   */
  skeleton?: ReactNode;
  /** The content is a poster rail, so a failure stands in a rail's room. */
  inRail?: boolean;
  children: ReactNode;
}) {
  const empty = count === 0;
  if (!sectionShown(read, count, skeleton !== undefined)) return null;
  const failure =
    read.error === null ? null : (
      <ErrorState
        error={read.error}
        what={what}
        onRetry={read.retry}
        headingLevel={3}
      />
    );
  return (
    <Section title={title} {...(link === undefined || empty ? {} : { link })}>
      {empty && failure === null && skeleton}
      {!empty && children}
      {failure !== null && inRail ? (
        <PosterRailStandIn>{failure}</PosterRailStandIn>
      ) : (
        failure
      )}
    </Section>
  );
}

/** A list of `Item`s, in as many columns as its own width holds. */
export function Items({
  label,
  stacked = false,
  children,
}: {
  label: string;
  /** One item to a line, for items that carry their own controls. */
  stacked?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={cx("itemsFrame")}>
      <ul
        className={stacked ? `${cx("items")} ${cx("stacked")}` : cx("items")}
        aria-label={label}
      >
        {children}
      </ul>
    </div>
  );
}

/**
 * One title in a section: a small poster, its name, and under it whatever
 * the section has to say about it. The name is a link to the title's page
 * when it has one, and the poster is part of that link. `action` is the
 * one thing to do about the title here, kept apart from the link.
 */
export function Item({
  media,
  title,
  to,
  action,
  children,
}: {
  media: ReactNode;
  title: string;
  to?: To;
  action?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <li className={cx("item")}>
      <div className={cx("itemMain")}>
        <div className={cx("itemMedia")}>{media}</div>
        <div className={cx("itemBody")}>
          <h3 className={cx("itemTitle")}>
            {to === undefined ? (
              title
            ) : (
              <Link className={cx("itemLink")} to={to}>
                {title}
              </Link>
            )}
          </h3>
          {children}
        </div>
      </div>
      {action !== undefined && <div className={cx("itemAction")}>{action}</div>}
    </li>
  );
}

/** A title's poster at the size an item shows it. */
export function ItemPoster({
  path,
  title,
}: {
  path: string | null;
  title: string;
}) {
  return <Poster path={path} title={title} sizes="56px" />;
}

/** A line of detail under an item's name. */
export function ItemDetail({ children }: { children: ReactNode }) {
  return <p className={cx("itemDetail")}>{children}</p>;
}

/** `Items` that are still loading, each in the room an item takes. */
export function ItemsSkeleton({
  label,
  count,
}: {
  label: string;
  count: number;
}) {
  return (
    <SkeletonStatus label={label}>
      <div className={cx("itemsFrame")}>
        <div className={cx("items")}>
          {Array.from({ length: count }, (_, index) => (
            <div className={cx("itemMain")} key={index}>
              <div className={`${cx("itemMedia")} ${cx("itemShape")}`}>
                <div className={shape("block")} />
              </div>
              <div className={cx("itemBody")}>
                <div className={`${shape("block")} ${shape("line")}`} />
                <div className={`${shape("block")} ${shape("shortLine")}`} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </SkeletonStatus>
  );
}
