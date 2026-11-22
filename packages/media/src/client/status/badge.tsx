import { Badge } from "#client/ui/feedback.tsx";
import { humanize } from "#client/components.tsx";
import { wireStatusTone } from "./tone.ts";

/**
 * A status the contract reports, as a badge. The tone is the one every page
 * gives that word (`tone.ts`); a word the table does not know reads as
 * neutral.
 */
export function StatusBadge({ value }: { value: string }) {
  return <Badge tone={wireStatusTone(value)}>{humanize(value)}</Badge>;
}
