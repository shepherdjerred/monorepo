import type { ReactNode } from "react";
import { CircleCheckIcon } from "lucide-react";
import { classNames } from "./class-names.ts";
import styles from "./data-list.module.css";

const cx = classNames(styles);

/**
 * Rows of the same kind of thing. Each row is a line when there is room
 * (what it is, its state, what can be done to it) and a stacked card when
 * there is not. The list measures itself, so it stacks in a narrow column
 * on a wide screen too.
 */
export function DataList({
  label,
  children,
}: {
  /** Names the list for assistive technology: "Members". */
  label: string;
  children: ReactNode;
}) {
  return (
    <div className={cx("frame")}>
      <ul className={cx("list")} aria-label={label}>
        {children}
      </ul>
    </div>
  );
}

/** Whether a slot was given something to show; `cond && <X />` may be `false`. */
function present(node: ReactNode): boolean {
  return node !== undefined && node !== null && node !== false;
}

export function DataRow({
  title,
  detail,
  status,
  note,
  actions,
  children,
}: {
  /** What the row is. */
  title: ReactNode;
  /** A line or two about it. */
  detail?: ReactNode;
  /** Its state, usually badges. */
  status?: ReactNode;
  /**
   * What was just done to it, in words. Pass `null` while there is nothing
   * to say, so the place it is read out from already exists.
   */
  note?: ReactNode;
  /** What can be done to it. */
  actions?: ReactNode;
  /** Anything that belongs under the row, such as a form or a message. */
  children?: ReactNode;
}) {
  return (
    <li className={cx("row")}>
      <div className={cx("line")}>
        <div className={cx("main")}>
          <div className={cx("title")}>{title}</div>
          {detail !== undefined && <div className={cx("detail")}>{detail}</div>}
          {note !== undefined && (
            <p className={cx("note")} role="status">
              {note !== null && (
                <>
                  <CircleCheckIcon aria-hidden="true" />
                  {note}
                </>
              )}
            </p>
          )}
        </div>
        {present(status) && <div className={cx("status")}>{status}</div>}
        {present(actions) && <div className={cx("actions")}>{actions}</div>}
      </div>
      {present(children) && <div className={cx("below")}>{children}</div>}
    </li>
  );
}
