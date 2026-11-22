import { ArrowLeftIcon } from "lucide-react";
import { Link, useNavigate } from "react-router";
import { z } from "zod";
import { classNames } from "#client/ui/class-names.ts";
import styles from "./title.module.css";

const cx = classNames(styles);

/** What the router keeps in `history.state`: how deep this entry is. */
const HistoryEntrySchema = z.object({ idx: z.number() });

/**
 * The way back from a title page: to wherever the reader came from, which
 * may be the Library, Discover, a calendar day, or another title. Someone
 * who opened the page from an email or a bookmark has nowhere to go back to
 * in this tab, so for them it leads to the Library.
 *
 * It is a link to the Library either way, so opening it in a new tab works.
 */
export function BackLink() {
  const navigate = useNavigate();
  const entry = HistoryEntrySchema.safeParse(globalThis.history.state);
  const cameFromSomewhere = entry.success && entry.data.idx > 0;
  return (
    <Link
      className={cx("back")}
      to="/library"
      onClick={(event) => {
        const plain =
          event.button === 0 &&
          !event.metaKey &&
          !event.ctrlKey &&
          !event.shiftKey &&
          !event.altKey;
        if (!cameFromSomewhere || !plain) return;
        event.preventDefault();
        void navigate(-1);
      }}
    >
      <ArrowLeftIcon aria-hidden="true" />
      {cameFromSomewhere ? "Back" : "Library"}
    </Link>
  );
}
