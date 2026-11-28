import {
  durationIso,
  formatDuration,
  toEpochMs,
  type TimeInput,
} from "@shepherdjerred/console-ui/format/format.ts";
import { useNow } from "@shepherdjerred/console-ui/format/use-now.ts";

export type DurationProps =
  | { readonly ms: number }
  | {
      readonly start: TimeInput;
      /** Omit while the span is still running; it then counts up to now. */
      readonly end?: TimeInput;
      /** Pin the clock for a running span (tests, snapshots). */
      readonly now?: TimeInput;
    };

/** A span as "2h 14m", from milliseconds or from a start and an end. */
export function Duration(props: DurationProps): React.JSX.Element {
  const ticked = useNow();
  let ms: number;
  if ("ms" in props) {
    ms = props.ms;
  } else {
    const end =
      props.end === undefined
        ? toEpochMs(props.now ?? ticked)
        : toEpochMs(props.end);
    ms = Math.max(0, end - toEpochMs(props.start));
  }
  return (
    <time className="ui-time ui-mono" dateTime={durationIso(ms)}>
      {formatDuration(ms)}
    </time>
  );
}
