import { useQuery } from "@tanstack/react-query";
import type { OperationsIntentKind } from "@scout-for-lol/data";
import { Button } from "@scout-for-lol/design-system/components/button";
import { OperationsBlockedReason } from "#src/components/operations/operations-blocked-reason.tsx";
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
  ErrorState,
  LoadingState,
} from "@scout-for-lol/design-system/domain/states";
import {
  operationsActionLabel,
  type OperationsMatchId,
  type OperationsRequestDraft,
} from "#src/lib/operations/operations-payloads.ts";
import {
  matchIntentRows,
  matchPipelineFacts,
  receiptScopeLabel,
  type MatchPipelineData,
} from "#src/lib/operations/operations-pipeline.ts";
import { useTRPC } from "#src/lib/query/trpc.ts";

/**
 * One match's whole durable picture.
 *
 * This is where the notification arms live rather than in the queue tables,
 * and the reason is the attempt nonce. Answering an unknown delivery means
 * naming the attempt that was investigated, and the nonce is on the intent's
 * state — visible here, and nowhere in the queue reads. Offering the answer
 * only where the attempt is on screen is what makes `stale-operator-view` a
 * rule the console respects rather than one it keeps tripping over.
 */

function PipelineFacts(props: { data: MatchPipelineData }) {
  return (
    <dl className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
      {matchPipelineFacts(props.data).map((fact) => (
        <div key={fact.label}>
          <dt className="text-xs uppercase tracking-wide text-scout-subtle">
            {fact.label}
          </dt>
          <dd className="font-medium text-scout-ink">{fact.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function ReceiptTable(props: { data: MatchPipelineData }) {
  const { receipts } = props.data.processing;
  if (receipts.length === 0) {
    return (
      <p className="text-sm text-scout-subtle">
        No receipts. Nothing downstream has attested to this match yet.
      </p>
    );
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Receipt</TableHead>
          <TableHead>Version</TableHead>
          <TableHead>Scope</TableHead>
          <TableHead>Recorded</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {receipts.map((receipt) => (
          <TableRow
            key={`${receipt.kind}:${receipt.version.toString()}:${receiptScopeLabel(receipt.scope)}`}
          >
            <TableCell className="font-mono text-xs">{receipt.kind}</TableCell>
            <TableCell>{receipt.version}</TableCell>
            <TableCell className="font-mono text-xs">
              {receiptScopeLabel(receipt.scope)}
            </TableCell>
            <TableCell className="text-xs text-scout-subtle">
              {receipt.recordedAt}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function IntentTable(props: {
  data: MatchPipelineData;
  onStart: (draft: OperationsRequestDraft) => void;
  canStart: (kind: OperationsIntentKind) => boolean;
  /** When this picture was read; freshness is judged against its own vintage. */
  readAt: number;
}) {
  const rows = matchIntentRows(props.data, props.readAt);
  if (rows.length === 0) {
    return (
      <p className="text-sm text-scout-subtle">
        No notification intents were minted for this match.
      </p>
    );
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Intent</TableHead>
          <TableHead>State</TableHead>
          <TableHead>Detail</TableHead>
          <TableHead>Operations</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.intentKey} data-intent-state={row.state}>
            <TableCell className="break-all font-mono text-xs">
              {row.intentKey}
            </TableCell>
            <TableCell>{row.state}</TableCell>
            <TableCell>
              <span className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-scout-subtle">
                {row.facts.map((fact) => (
                  <span key={fact.label}>
                    <span className="font-medium text-scout-ink">
                      {fact.label}
                    </span>{" "}
                    <span className="break-all font-mono">{fact.value}</span>
                  </span>
                ))}
              </span>
            </TableCell>
            <TableCell>
              {row.blocked === null ? (
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
                </span>
              ) : (
                <OperationsBlockedReason blocked={row.blocked} />
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function TrackedAccountTable(props: { data: MatchPipelineData }) {
  const accounts = props.data.trackedAccounts;
  if (accounts.length === 0) return null;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>PUUID</TableHead>
          <TableHead>Player</TableHead>
          <TableHead>Account</TableHead>
          <TableHead>Cursor advanced</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {accounts.map((account) => (
          <TableRow key={account.puuid}>
            <TableCell className="break-all font-mono text-xs">
              {account.puuid}
            </TableCell>
            <TableCell>{account.playerId ?? "unregistered"}</TableCell>
            <TableCell>{account.accountId ?? "unregistered"}</TableCell>
            <TableCell className="text-xs text-scout-subtle">
              {account.cursorAdvancedAt ?? "never"}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function OperationsMatchPanel(props: {
  matchId: OperationsMatchId;
  onStart: (draft: OperationsRequestDraft) => void;
  canStart: (kind: OperationsIntentKind) => boolean;
}) {
  const trpc = useTRPC();
  const pipeline = useQuery(
    trpc.operations.matchPipeline.queryOptions({ matchId: props.matchId }),
  );

  return (
    <Card data-operations-match={props.matchId}>
      <CardHeader>
        <CardTitle>{props.matchId}</CardTitle>
        <CardDescription>
          Owner, policy, receipts and notification intents, as the durable
          pipeline holds them.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {pipeline.isPending && <LoadingState label="Reading the pipeline…" />}
        {pipeline.error !== null && (
          <ErrorState
            title="That match could not be read"
            message={pipeline.error.message}
            onRetry={() => {
              void pipeline.refetch();
            }}
          />
        )}
        {pipeline.data?.kind === "not-found" && (
          <p className="text-sm text-scout-subtle">
            This pipeline has never observed that match, so there is no state to
            operate on.
          </p>
        )}
        {pipeline.data?.kind === "found" && (
          <>
            <PipelineFacts data={pipeline.data.state} />
            <section className="space-y-2">
              <h4 className="text-sm font-semibold">Receipts</h4>
              <ReceiptTable data={pipeline.data.state} />
            </section>
            <section className="space-y-2">
              <h4 className="text-sm font-semibold">Notification intents</h4>
              <IntentTable
                data={pipeline.data.state}
                onStart={props.onStart}
                canStart={props.canStart}
                readAt={pipeline.dataUpdatedAt}
              />
            </section>
            <section className="space-y-2">
              <h4 className="text-sm font-semibold">Tracked accounts</h4>
              <TrackedAccountTable data={pipeline.data.state} />
            </section>
          </>
        )}
      </CardContent>
    </Card>
  );
}
