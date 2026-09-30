import type { OperationsIntentKind } from "@scout-for-lol/data";
import { OperationsBlockedReason } from "#src/components/operations/operations-blocked-reason.tsx";
import { Button } from "@scout-for-lol/design-system/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@scout-for-lol/design-system/components/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@scout-for-lol/design-system/components/table";
import {
  operationsActionLabel,
  type OperationsRequestDraft,
} from "#src/lib/operations/operations-payloads.ts";
import type {
  OperationsQueue,
  OperationsRowFact,
} from "#src/lib/operations/operations-queues.ts";

/**
 * One durable queue, as a table an operator can act on.
 *
 * An empty queue keeps its heading and says so rather than disappearing: during
 * a soak, "nothing is stalled" is the answer being looked for, and a section
 * that vanishes when it empties cannot give it.
 *
 * The header counts what is SHOWING, never a total. Each read returns a bounded
 * page, so the number of rows on screen is the only quantity this console can
 * prove — printing it as a total would invent a backlog size nobody measured.
 */

function RowFacts(props: { facts: readonly OperationsRowFact[] }) {
  if (props.facts.length === 0) {
    return <span className="text-scout-subtle">—</span>;
  }
  return (
    <span className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-scout-subtle">
      {props.facts.map((fact) => (
        <span key={fact.label}>
          <span className="font-medium text-scout-ink">{fact.label}</span>{" "}
          <span className="break-all font-mono">{fact.value}</span>
        </span>
      ))}
    </span>
  );
}

export function OperationsQueuePanel(props: {
  queue: OperationsQueue;
  onStart: (draft: OperationsRequestDraft) => void;
  onInspect: (matchId: string) => void;
  /** Whether an arm can be started right now. The page owns the reason. */
  canStart: (kind: OperationsIntentKind) => boolean;
  /** Fetch the next page of THIS queue. Only called when `hasMore`. */
  onLoadMore: () => void;
  loadingMore: boolean;
  /** Whether a search is narrowing the rows, which changes what empty means. */
  searchActive: boolean;
}) {
  const { queue } = props;
  return (
    <Card data-operations-queue={queue.id}>
      <CardHeader>
        <CardTitle>
          {queue.title} — showing {queue.rows.length}
          {queue.hasMore ? ", more available" : ""}
        </CardTitle>
        <CardDescription>{queue.description}</CardDescription>
      </CardHeader>
      <CardContent>
        {queue.rows.length === 0 ? (
          <p className="text-sm text-scout-subtle">
            {props.searchActive
              ? /*
                 * Never "no results": only the loaded rows were searched, and
                 * this queue still has pages behind it. Saying how many were
                 * looked at is what keeps a partial search from reading as a
                 * finished one.
                 */
                `No loaded rows match. ${queue.loadedCount.toString()} loaded so far, more available — load more to search further.`
              : "Nothing in this queue."}
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Identifier</TableHead>
                <TableHead>Detail</TableHead>
                <TableHead>Operations</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {queue.rows.map((row) => {
                const inspectMatchId = row.inspectMatchId;
                return (
                  <TableRow key={row.id}>
                    <TableCell className="break-all font-mono text-xs">
                      {row.primary}
                    </TableCell>
                    <TableCell>
                      <RowFacts facts={row.facts} />
                    </TableCell>
                    <TableCell>
                      {row.blocked !== null && (
                        <OperationsBlockedReason blocked={row.blocked} />
                      )}
                      <span className="flex flex-wrap gap-2">
                        {row.drafts.map((draft) => (
                          <Button
                            key={draft.kind}
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={!props.canStart(draft.kind)}
                            onClick={() => {
                              props.onStart(draft);
                            }}
                          >
                            {operationsActionLabel(draft.kind)}
                          </Button>
                        ))}
                        {inspectMatchId !== null && (
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              props.onInspect(inspectMatchId);
                            }}
                          >
                            Inspect
                          </Button>
                        )}
                      </span>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
        {queue.hasMore && (
          <div className="pt-3">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={props.loadingMore}
              onClick={props.onLoadMore}
            >
              {props.loadingMore ? "Loading…" : "Load more"}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
