import {
  formatExact,
  formatRelative,
  toIso,
  type TimeInput,
} from "@shepherdjerred/console-ui/format/format.ts";
import { useNow } from "@shepherdjerred/console-ui/format/use-now.ts";

export type RelativeTimeProps = {
  readonly value: TimeInput;
  /** Pin the clock (tests, snapshots); otherwise the shared 30s ticker. */
  readonly now?: TimeInput;
};

/**
 * "3m ago", with the exact Pacific time in the tooltip and the ISO moment
 * in `dateTime`. Every relative time on a page shares one ticker.
 */
export function RelativeTime({
  value,
  now,
}: RelativeTimeProps): React.JSX.Element {
  const ticked = useNow();
  return (
    <time
      className="ui-time"
      dateTime={toIso(value)}
      title={formatExact(value, { precision: "second", year: true })}
    >
      {formatRelative(value, now ?? ticked)}
    </time>
  );
}
