import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { OperationsIntentKind } from "@scout-for-lol/data";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@scout-for-lol/design-system/components/alert";
import { Button } from "@scout-for-lol/design-system/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@scout-for-lol/design-system/components/card";
import { Checkbox } from "@scout-for-lol/design-system/components/forms/checkbox";
import {
  Field,
  FieldError,
  Input,
  Label,
} from "@scout-for-lol/design-system/components/forms/field";
import {
  ErrorState,
  LoadingState,
} from "@scout-for-lol/design-system/domain/states";
import { FilterSelect } from "#src/components/filter-select.tsx";
import { OperationsMatchPanel } from "#src/components/operations/operations-match-panel.tsx";
import { OperationsQueuePanel } from "#src/components/operations/operations-queue-panel.tsx";
import { OperationsRequestPanel } from "#src/components/operations/operations-request-panel.tsx";
import {
  operationsStartsWorkflow,
  parseOperationsMatchId,
  type OperationsMatchId,
  type OperationsRequestDraft,
} from "#src/lib/operations/operations-payloads.ts";
import {
  appendOperationsPage,
  EMPTY_OPERATIONS_FILTER,
  filterOperationsQueues,
  operationsQueues,
  operationsRowCount,
  type OperationsFilter,
  type OperationsQueueId,
  type OperationsQueueSource,
  type OperationsQueuesData,
} from "#src/lib/operations/operations-queues.ts";
import { useOperationsAvailability } from "#src/routes/operations/operations-workspace.tsx";
import { useTRPC } from "#src/lib/query/trpc.ts";

/**
 * The match operations console.
 *
 * One request runs at a time. An operations intent lives five minutes because
 * it is prepared against a view of the queues that keeps moving, and two
 * unanswered confirmations on one screen is how an operator confirms the one
 * they did not mean to — so every other control is closed while one is open.
 */

const QUEUE_FILTER_OPTIONS: readonly (OperationsQueueId | "all")[] = [
  "all",
  "stalled-matches",
  "stalled-notifications",
  "unknown-deliveries",
  "unprojected-matches",
  "recovery-batches",
  "unaccepted-starts",
];

function FilterBar(props: {
  filter: OperationsFilter;
  onChange: (filter: OperationsFilter) => void;
  shown: number;
  moreAvailable: boolean;
}) {
  return (
    <div className="flex flex-wrap items-end gap-4">
      <div className="w-56">
        <FilterSelect
          label="Queue"
          value={props.filter.queue}
          options={QUEUE_FILTER_OPTIONS}
          onChange={(queue) => {
            props.onChange({ ...props.filter, queue });
          }}
        />
      </div>
      <Field className="w-72">
        <Label htmlFor="operations-search">Match, intent or batch</Label>
        <Input
          id="operations-search"
          value={props.filter.search}
          placeholder="NA1_1234567890"
          onChange={(event) => {
            props.onChange({ ...props.filter, search: event.target.value });
          }}
        />
      </Field>
      <div className="flex items-center gap-2 pb-2 text-sm">
        <Checkbox
          id="operations-stalled-only"
          checked={props.filter.stalledOnly}
          onCheckedChange={(checked) => {
            props.onChange({
              ...props.filter,
              stalledOnly: checked === true,
            });
          }}
        />
        <Label htmlFor="operations-stalled-only">Stalled only</Label>
      </div>
      {/*
       * "showing", never a total: each read returns a bounded page, so the
       * rows on screen are the only quantity this console can prove.
       */}
      <p className="pb-2 text-sm text-scout-subtle">
        showing {props.shown} row{props.shown === 1 ? "" : "s"}
        {props.moreAvailable ? ", more available" : ""}
      </p>
    </div>
  );
}

function MatchLookup(props: {
  value: string;
  error: string | null;
  onChange: (value: string) => void;
  onInspect: () => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Inspect a match</CardTitle>
        <CardDescription>
          Owner, policy, receipts, notification intents and tracked accounts for
          one match. The notification arms live here, where the attempt nonce is
          on screen.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Field>
          <Label htmlFor="operations-match">Riot match id</Label>
          <div className="flex gap-2">
            <Input
              id="operations-match"
              className="max-w-xs"
              value={props.value}
              placeholder="NA1_1234567890"
              onChange={(event) => {
                props.onChange(event.target.value);
              }}
            />
            <Button type="button" size="sm" onClick={props.onInspect}>
              Inspect
            </Button>
          </div>
          {props.error !== null && <FieldError>{props.error}</FieldError>}
        </Field>
      </CardContent>
    </Card>
  );
}

export function OperationsMatches() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { temporal } = useOperationsAvailability();
  const queuesQuery = useQuery(trpc.operations.queues.queryOptions({}));
  /**
   * Pages fetched beyond the first, tied to the read they extend. A fresh base
   * result carries a new `dataUpdatedAt`, which retires the accumulation rather
   * than stacking newer pages onto a stale one — so the re-read that follows an
   * operation starts from the top, as it should.
   */
  const [extra, setExtra] = useState<{
    at: number;
    data: OperationsQueuesData;
  } | null>(null);
  const [loadingQueue, setLoadingQueue] =
    useState<OperationsQueueSource | null>(null);
  const [filter, setFilter] = useState<OperationsFilter>(
    EMPTY_OPERATIONS_FILTER,
  );
  const [request, setRequest] = useState<{
    id: number;
    draft: OperationsRequestDraft;
  } | null>(null);
  const [matchInput, setMatchInput] = useState("");
  const [inspected, setInspected] = useState<OperationsMatchId | null>(null);
  const [matchError, setMatchError] = useState<string | null>(null);

  function start(draft: OperationsRequestDraft): void {
    setRequest((current) => ({ id: (current?.id ?? 0) + 1, draft }));
  }

  function inspect(value: string): void {
    const parsed = parseOperationsMatchId(value);
    setMatchInput(value);
    if (parsed === null) {
      setMatchError("That is not a well-formed Riot match id.");
      setInspected(null);
      return;
    }
    setMatchError(null);
    setInspected(parsed);
  }

  function canStart(kind: OperationsIntentKind): boolean {
    return (
      request === null &&
      (temporal === "available" || !operationsStartsWorkflow(kind))
    );
  }

  const loaded =
    extra !== null && extra.at === queuesQuery.dataUpdatedAt
      ? extra.data
      : queuesQuery.data;

  async function loadMore(source: OperationsQueueSource): Promise<void> {
    const cursor = loaded?.pages[source].cursor;
    if (loaded === undefined || cursor === null || cursor === undefined) return;
    setLoadingQueue(source);
    try {
      const next = await queryClient.query(
        trpc.operations.queues.queryOptions({ after: { [source]: cursor } }),
      );
      setExtra({
        at: queuesQuery.dataUpdatedAt,
        data: appendOperationsPage(loaded, source, next),
      });
    } finally {
      setLoadingQueue(null);
    }
  }

  // Freshness is judged against the moment the rows were read rather than a
  // ticking clock: the deadline on a row was true as of that read, and the
  // server's own refusal is the backstop if the page has since gone stale.
  const queues =
    loaded === undefined
      ? []
      : filterOperationsQueues(
          operationsQueues(loaded, queuesQuery.dataUpdatedAt),
          filter,
        );

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">Match operations</h1>
        <p className="text-sm text-scout-subtle">
          The durable match pipeline, and the six operations that move it. Every
          one is prepared, reviewed and then confirmed; nothing here acts on a
          single click.
        </p>
      </header>

      {temporal === "unavailable" && (
        <Alert tone="warning">
          <AlertTitle>Temporal is unreachable</AlertTitle>
          <AlertDescription>
            Reconciliation, notification re-drives and projection repairs are
            closed, because a start Temporal never accepts is a durable request
            nothing will pick up. Suppressions, delivery answers and policy
            widening are unaffected — those commit in the database.
          </AlertDescription>
        </Alert>
      )}

      {request !== null && (
        <OperationsRequestPanel
          key={request.id}
          initialDraft={request.draft}
          onClose={() => {
            setRequest(null);
          }}
        />
      )}

      <Card>
        <CardHeader>
          <CardTitle>Reconcile the pipeline</CardTitle>
          <CardDescription>
            Sweep the durable pipeline for work its owners dropped. This is the
            only operation that is not aimed at a single row.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            type="button"
            size="sm"
            disabled={!canStart("ops_reconcile_pipeline")}
            onClick={() => {
              start({ kind: "ops_reconcile_pipeline" });
            }}
          >
            Reconcile
          </Button>
        </CardContent>
      </Card>

      <FilterBar
        filter={filter}
        onChange={setFilter}
        shown={operationsRowCount(queues)}
        moreAvailable={queues.some((queue) => queue.hasMore)}
      />

      {queuesQuery.isPending && <LoadingState label="Reading the queues…" />}
      {queuesQuery.error !== null && (
        <ErrorState
          title="The queues could not be read"
          message={queuesQuery.error.message}
          onRetry={() => {
            void queuesQuery.refetch();
          }}
        />
      )}
      {queues.map((queue) => (
        <OperationsQueuePanel
          key={queue.id}
          queue={queue}
          onStart={start}
          onInspect={inspect}
          canStart={canStart}
          onLoadMore={() => {
            void loadMore(queue.source);
          }}
          loadingMore={loadingQueue === queue.source}
          searchActive={filter.search.trim() !== ""}
        />
      ))}
      {loaded !== undefined && queues.length === 0 && (
        <p className="text-sm text-scout-subtle">
          No queue matches that filter.
        </p>
      )}

      <MatchLookup
        value={matchInput}
        error={matchError}
        onChange={setMatchInput}
        onInspect={() => {
          inspect(matchInput);
        }}
      />
      {inspected !== null && (
        <OperationsMatchPanel
          matchId={inspected}
          onStart={start}
          canStart={canStart}
        />
      )}
    </div>
  );
}
