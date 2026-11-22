import type { ReactNode } from "react";
import { Link, type To } from "react-router";
import { classNames } from "./class-names.ts";
import styles from "./section.module.css";

const cx = classNames(styles);

/**
 * One part of a page that has several: a heading, the content under it, and
 * optionally one link beside the heading that leads to all of it ("See
 * all").
 *
 * The heading is how a section is found. It is not a landmark: a page with
 * six of them would crowd the ones the shell has.
 */
export function Section({
  title,
  link,
  children,
}: {
  title: string;
  link?: {
    to: To;
    text: string;
    /**
     * What a list of links calls it, when `text` alone would not say which
     * section it belongs to. Starts with `text`.
     */
    label?: string;
  };
  children: ReactNode;
}) {
  return (
    <section className={cx("section")}>
      <div className={cx("head")}>
        <h2 className={cx("title")}>{title}</h2>
        {link !== undefined && (
          <Link className={cx("link")} to={link.to} aria-label={link.label}>
            {link.text}
          </Link>
        )}
      </div>
      {children}
    </section>
  );
}
