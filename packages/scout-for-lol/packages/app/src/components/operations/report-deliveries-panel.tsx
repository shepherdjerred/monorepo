import { Button } from "@scout-for-lol/design-system/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@scout-for-lol/design-system/components/card";
import { LoadingState } from "@scout-for-lol/design-system/domain/states";
import type { RouterOutputs } from "#src/lib/query/trpc.ts";
import type { OperationsRequestDraft } from "#src/lib/operations/operations-payloads.ts";

export function ReportDeliveriesPanel(props: {
  chunks: RouterOutputs["operations"]["reportDeliveries"] | undefined;
  pending: boolean;
  error: { message: string } | null;
  canStart: boolean;
  onStart: (draft: OperationsRequestDraft) => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Report deliveries needing an answer</CardTitle>
        <CardDescription>
          Check the destination before answering an unknown send. Sending
          attempts can be answered 35 minutes after they started.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {props.pending && <LoadingState label="Reading report deliveries…" />}
        {props.error !== null && <p role="alert">{props.error.message}</p>}
        {props.chunks?.length === 0 && (
          <p>No report deliveries need resolution.</p>
        )}
        {props.chunks?.map((chunk) => (
          <div
            key={`${chunk.reportRunId.toString()}:${chunk.channelId}:${chunk.chunkIndex.toString()}`}
            className="space-y-2 rounded border border-border p-3"
          >
            <p>
              Run {chunk.reportRunId}, chunk {chunk.chunkIndex} · channel{" "}
              {chunk.channelId} · {chunk.state.toLowerCase()}
            </p>
            <pre className="whitespace-pre-wrap text-xs">{chunk.content}</pre>
            <p className="break-all text-xs text-scout-subtle">
              Guild {chunk.serverId} · attempt {chunk.nonce}
              {chunk.sendStartedAt === null
                ? ""
                : ` · started ${new Date(chunk.sendStartedAt).toLocaleString()}`}
            </p>
            {chunk.lastError !== null && (
              <p className="text-sm text-scout-danger">{chunk.lastError}</p>
            )}
            <Button
              size="sm"
              disabled={!props.canStart}
              onClick={() => {
                props.onStart({
                  kind: "ops_resolve_report_delivery",
                  runId: chunk.reportRunId,
                  channelId: chunk.channelId,
                  chunkIndex: chunk.chunkIndex,
                  attemptNonce: chunk.nonce,
                  outcome: "not-delivered",
                  messageId: "",
                  deliveredAt: "",
                });
              }}
            >
              Answer delivery
            </Button>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
