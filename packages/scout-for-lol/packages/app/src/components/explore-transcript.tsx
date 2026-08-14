import { useState } from "react";
import { match } from "ts-pattern";
import type {
  ExploreMessage,
  ReportAiPreviewSummary,
  ReportValueFormat,
} from "@scout-for-lol/data";
import { Button } from "#src/components/ui/button.tsx";
import { InteractiveVisualization } from "#src/components/interactive-visualization.tsx";

/**
 * Renders an explore conversation.
 *
 * Used by both the live page and the read-only shared page, which is what
 * keeps a shared link looking like what the asker saw. The prose is the
 * answer; the chart and table support it; the ScoutQL is evidence, collapsed
 * by default so it does not compete with the answer for attention.
 */
export function ExploreTranscript(props: {
  messages: ExploreMessage[];
  /** Prose streaming in for a turn that has not been persisted yet. */
  pendingAnswer?: string | null;
  pendingQuestion?: string | null;
  activity?: string | null;
  onFollowUp?: (question: string) => void;
}) {
  return (
    <div className="space-y-6">
      {props.messages.map((message) =>
        message.role === "user" ? (
          <UserTurn key={message.id} content={message.content} />
        ) : (
          <AssistantTurn
            key={message.id}
            message={message}
            {...(props.onFollowUp === undefined
              ? {}
              : { onFollowUp: props.onFollowUp })}
          />
        ),
      )}

      {props.pendingQuestion !== undefined &&
        props.pendingQuestion !== null && (
          <UserTurn content={props.pendingQuestion} />
        )}

      {props.pendingAnswer !== undefined && props.pendingAnswer !== null && (
        <div className="space-y-2">
          <p className="whitespace-pre-wrap text-sm leading-relaxed">
            {props.pendingAnswer}
          </p>
        </div>
      )}

      {props.activity !== undefined && props.activity !== null && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <span className="inline-block size-2 animate-pulse rounded-full bg-current" />
          {props.activity}
        </p>
      )}
    </div>
  );
}

function UserTurn(props: { content: string }) {
  return (
    <div className="flex justify-end">
      <p className="max-w-[80%] rounded-lg bg-muted px-3 py-2 text-sm whitespace-pre-wrap">
        {props.content}
      </p>
    </div>
  );
}

function AssistantTurn(props: {
  message: ExploreMessage;
  onFollowUp?: (question: string) => void;
}) {
  const { message } = props;
  const [showQuery, setShowQuery] = useState(false);

  return (
    <div className="space-y-3">
      <p className="text-sm leading-relaxed whitespace-pre-wrap">
        {message.content}
      </p>

      {message.visualization !== null && (
        <div className="rounded-lg border p-3">
          <InteractiveVisualization snapshot={message.visualization} compact />
        </div>
      )}

      {message.visualization === null && message.preview !== null && (
        <PreviewTable preview={message.preview} />
      )}

      {message.caveats.length > 0 && (
        <ul className="space-y-1 text-xs text-muted-foreground">
          {message.caveats.map((caveat) => (
            <li key={caveat}>• {caveat}</li>
          ))}
        </ul>
      )}

      {message.queryText !== null && (
        <div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setShowQuery(!showQuery);
            }}
          >
            {showQuery ? "Hide the query" : "Show the query"}
          </Button>
          {showQuery && (
            <pre className="mt-2 overflow-x-auto rounded-md bg-muted p-3 text-xs">
              <code>{message.queryText}</code>
            </pre>
          )}
        </div>
      )}

      {props.onFollowUp !== undefined && message.followUps.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {message.followUps.map((followUp) => (
            <Button
              key={followUp}
              variant="outline"
              size="sm"
              onClick={() => {
                props.onFollowUp?.(followUp);
              }}
            >
              {followUp}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Fallback table for answers whose render kind produced no chart (a plain
 * table or leaderboard). Bounded to what the preview carries.
 */
function PreviewTable(props: { preview: ReportAiPreviewSummary }) {
  const { preview } = props;
  if (preview.rows.length === 0) {
    return null;
  }
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50">
          <tr>
            <th className="px-3 py-2 text-left font-medium">Row</th>
            {preview.columns.map((column) => (
              <th key={column.key} className="px-3 py-2 text-right font-medium">
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {preview.rows.map((row) => (
            <tr key={row.label} className="border-t">
              <td className="px-3 py-2">{row.label}</td>
              {preview.columns.map((column) => (
                <td key={column.key} className="px-3 py-2 text-right">
                  {formatValue(
                    row.values.find((value) => value.column === column.key)
                      ?.value ?? null,
                    column.format,
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Render a cell using the column's declared format.
 *
 * The format matters for reading the answer, not just for polish: a win rate
 * shown as "56.40" reads as a count, and the prose next to it says "56.4%".
 */
function formatValue(
  value: string | number | null,
  format: ReportValueFormat,
): string {
  if (value === null) {
    return "—";
  }
  if (typeof value === "string") {
    return value;
  }
  return match(format)
    .with("percent", () => `${value.toFixed(1)}%`)
    .with("integer", () => Math.round(value).toLocaleString())
    .with("decimal", () => value.toFixed(2))
    .with("text", () => value.toString())
    .exhaustive();
}
