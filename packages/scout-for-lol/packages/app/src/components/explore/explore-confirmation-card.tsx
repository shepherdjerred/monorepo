import type { ReactNode } from "react";
import { CheckCircle2, CircleX, Clock3 } from "lucide-react";
import { formatDurationSeconds } from "@scout-for-lol/data";
import type { ConfirmationCardState } from "#src/lib/explore-intent-cards.ts";

/**
 * The shell every Explore confirmation is rendered in.
 *
 * A dare action and a prepared report look nothing alike in their middles and
 * exactly alike at their edges: a heading that says what confirming does, a
 * clock counting down a single-use intent, the body, and one control. Sharing
 * the frame is what keeps "confirmed" and "expired" reading the same way
 * whichever family produced them — the reader is being asked to authorize
 * something either way.
 *
 * Presentational only. It receives a state rather than deriving one, so the
 * decision stays in `confirmationCardState` where it can be tested without a
 * renderer.
 */

function StateIcon(props: { state: ConfirmationCardState }) {
  if (props.state === "confirmed") {
    return <CheckCircle2 className="size-4 text-scout-primary" />;
  }
  if (props.state === "expired" || props.state === "failed") {
    return <CircleX className="size-4 text-scout-danger" />;
  }
  return <Clock3 className="size-4 text-scout-primary" />;
}

/**
 * The remaining life of the intent.
 *
 * A countdown rather than a wall-clock time: these expire ten minutes after
 * they are minted, and "expires in 02:14" answers the only question a reader
 * has. A settled card drops the clock entirely — how long an already-answered
 * confirmation had left is noise.
 */
function ExpiryClock(props: {
  state: ConfirmationCardState;
  expiresInMs: number;
}) {
  if (props.state === "confirmed" || props.state === "failed") return null;
  if (props.state === "expired" || props.expiresInMs <= 0) {
    return (
      <p className="text-xs text-scout-subtle">
        This single-use confirmation has expired.
      </p>
    );
  }
  return (
    <p className="text-xs text-scout-subtle">
      This single-use confirmation expires in{" "}
      {/* A remaining duration, not a time of day, so deliberately not <time>. */}
      <span className="tabular-nums">
        {formatDurationSeconds(Math.floor(props.expiresInMs / 1000))}
      </span>
      .
    </p>
  );
}

export function ExploreConfirmationCard(props: {
  state: ConfirmationCardState;
  heading: string;
  /** How long the intent has left, from the card's own ticking clock. */
  expiresInMs: number;
  /** The kind-specific recap of what confirming would do. */
  children?: ReactNode;
  /** The confirm button, a deep link, or an outcome message. */
  footer?: ReactNode;
}) {
  return (
    <section
      // The state is in the markup so a card's rendering can be asserted
      // without reaching for colours or icon internals.
      data-confirmation-state={props.state}
      className="space-y-3 rounded-lg border border-scout-primary/40 bg-scout-primary/5 p-4"
    >
      <div className="flex items-center gap-2">
        <StateIcon state={props.state} />
        <h3 className="font-medium">{props.heading}</h3>
      </div>
      {props.children}
      <ExpiryClock state={props.state} expiresInMs={props.expiresInMs} />
      {props.footer}
    </section>
  );
}

/** One line of settled outcome text, coloured by whether it went well. */
export function ConfirmationOutcomeMessage(props: {
  status: "confirmed" | "failed";
  message: string;
  /** Dare messages are result kinds (`already_funded`); creations are prose. */
  capitalize?: boolean;
}) {
  return (
    <p
      className={[
        "text-sm",
        props.capitalize === true ? "capitalize" : "",
        props.status === "failed" ? "text-scout-danger" : "",
      ]
        .filter((token) => token !== "")
        .join(" ")}
    >
      {props.message}
    </p>
  );
}
