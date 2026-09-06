import { Badge } from "@scout-for-lol/design-system/components/badge";
import { formatRemaining } from "#src/lib/bucks/bucks-countdown.ts";

/**
 * The betting-window countdown. Purely cosmetic — the caller computes the
 * remaining time against the server clock, and the server still owns whether
 * a submission is accepted.
 */
export function BucksCountdown(props: { remainingMs: number }) {
  if (props.remainingMs <= 0) {
    return <Badge variant="outline">Betting closed</Badge>;
  }
  return (
    <span className="text-scout-subtle text-sm">
      Closes in {formatRemaining(props.remainingMs)}
    </span>
  );
}
