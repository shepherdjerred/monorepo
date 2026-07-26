import {
  queueDisplayLabels,
  subscriptionFilterQueues,
} from "@scout-for-lol/data";
import { Badge } from "#src/components/ui/badge.tsx";

/**
 * Queue filters as compact badges: up to two, then a "+N more" summary.
 * Labels, not raw queues: the Doom Bots trio collapses to one badge.
 * Shared by the Subscriptions tab and the player page.
 */
export function FilterSummary(props: {
  filters: Parameters<typeof subscriptionFilterQueues>[0];
  isMuted: boolean;
}) {
  const labels = queueDisplayLabels(subscriptionFilterQueues(props.filters));
  const shown = labels.slice(0, 2);
  const extra = labels.length - shown.length;
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {labels.length === 0 ? (
        <span>All queues</span>
      ) : (
        <>
          {shown.map((label) => (
            <Badge key={label} variant="secondary" className="font-normal">
              {label}
            </Badge>
          ))}
          {extra > 0 && (
            <span className="text-xs" title={labels.join(", ")}>
              +{extra.toString()} more
            </span>
          )}
        </>
      )}
      {props.isMuted && <Badge variant="outline">Muted</Badge>}
    </span>
  );
}
