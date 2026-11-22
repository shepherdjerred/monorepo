import type { ReactNode } from "react";
import {
  CircleAlertIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  InfoIcon,
  RotateCwIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { Button } from "./button.tsx";
import { classNames } from "./class-names.ts";
import styles from "./feedback.module.css";

const cx = classNames(styles);

type Tone = "neutral" | "ok" | "warn" | "danger";

const TONE_ICONS = {
  neutral: InfoIcon,
  ok: CircleCheckIcon,
  warn: TriangleAlertIcon,
  danger: CircleAlertIcon,
} as const;

/**
 * A message set apart from the text around it. A `danger` callout is an
 * alert and is read out when it appears; the others are read politely.
 */
export function Callout({
  tone = "neutral",
  title,
  children,
  action,
}: {
  tone?: Tone;
  title?: string;
  children: ReactNode;
  /** A button that acts on the message, such as a retry. */
  action?: ReactNode;
}) {
  const Icon = TONE_ICONS[tone];
  return (
    <div
      className={cx("callout")}
      data-tone={tone}
      role={tone === "danger" ? "alert" : "status"}
    >
      <Icon aria-hidden="true" />
      <div className={cx("calloutBody")}>
        {title !== undefined && <p className={cx("calloutTitle")}>{title}</p>}
        <div className={cx("calloutText")}>{children}</div>
        {action}
      </div>
    </div>
  );
}

/** A section's data could not be loaded: what failed, why, and a way to retry. */
export function LoadError({
  what,
  error,
  retry,
}: {
  /** What could not be loaded, as the subject of a sentence: "Members". */
  what: string;
  error: Error;
  retry: () => void;
}) {
  return (
    <Callout
      tone="danger"
      title={`${what} could not be loaded`}
      action={
        <Button onClick={retry}>
          <RotateCwIcon aria-hidden="true" />
          Try again
        </Button>
      }
    >
      {error.message}
    </Callout>
  );
}

/**
 * A short label for the state of a thing. The icon carries the tone without
 * color. `progress` is a thing under way, which a callout never is.
 */
export function Badge({
  tone = "neutral",
  children,
}: {
  tone?: Tone | "progress";
  children: ReactNode;
}) {
  const Icon =
    tone === "neutral"
      ? null
      : tone === "progress"
        ? CircleDashedIcon
        : TONE_ICONS[tone];
  return (
    <span className={cx("badge")} data-tone={tone}>
      {Icon !== null && <Icon aria-hidden="true" />}
      {children}
    </span>
  );
}
