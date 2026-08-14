import { useEffect, useState } from "react";
import { match } from "ts-pattern";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Pencil,
  RefreshCw,
} from "lucide-react";
import type {
  ExploreMessage,
  ReportAiPreviewSummary,
  ReportValueFormat,
} from "@scout-for-lol/data";
import { Button } from "#src/components/ui/button.tsx";
import { Textarea } from "#src/components/ui/textarea.tsx";
import { InteractiveVisualization } from "#src/components/interactive-visualization.tsx";
import { MarkdownAnswer } from "#src/components/markdown-answer.tsx";

/**
 * Renders one path through an explore conversation.
 *
 * Used by both the live page and the read-only shared page, which is what
 * keeps a shared link looking like what the asker saw. The prose is the
 * answer; the chart and table support it; the ScoutQL and the tool trace are
 * evidence, collapsed by default so they do not compete with the answer.
 *
 * Actions are opt-in per callback, so the shared view gets the same rendering
 * with none of the controls simply by passing none of them.
 */
export type ExploreTranscriptActions = {
  onFollowUp?: (question: string) => void;
  onEdit?: (message: ExploreMessage, question: string) => void;
  onRegenerate?: (message: ExploreMessage) => void;
  onSelectVersion?: (messageId: string) => void;
};

export function ExploreTranscript(
  props: {
    messages: ExploreMessage[];
    /** Prose streaming in for a turn that has not been persisted yet. */
    pendingAnswer?: string | null;
    pendingQuestion?: string | null;
    activity?: string | null;
  } & ExploreTranscriptActions,
) {
  return (
    <div className="space-y-6">
      {props.messages.map((message) =>
        message.role === "user" ? (
          <UserTurn key={message.id} message={message} actions={props} />
        ) : (
          <AssistantTurn key={message.id} message={message} actions={props} />
        ),
      )}

      {props.pendingQuestion !== undefined &&
        props.pendingQuestion !== null && (
          <UserBubble content={props.pendingQuestion} />
        )}

      {props.pendingAnswer !== undefined && props.pendingAnswer !== null && (
        <MarkdownAnswer>{props.pendingAnswer}</MarkdownAnswer>
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

function UserBubble(props: { content: string }) {
  return (
    <div className="flex justify-end">
      <p className="max-w-[80%] rounded-lg bg-muted px-3 py-2 text-sm whitespace-pre-wrap">
        {props.content}
      </p>
    </div>
  );
}

function UserTurn(props: {
  message: ExploreMessage;
  actions: ExploreTranscriptActions;
}) {
  const { message, actions } = props;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.content);

  // A late-arriving refetch shouldn't strand the textarea on stale text.
  useEffect(() => {
    setDraft(message.content);
  }, [message.content]);

  if (editing) {
    return (
      <div className="space-y-2">
        <Textarea
          value={draft}
          rows={3}
          onChange={(event) => {
            setDraft(event.target.value);
          }}
        />
        <div className="flex justify-end gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setDraft(message.content);
              setEditing(false);
            }}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={draft.trim().length === 0}
            onClick={() => {
              setEditing(false);
              actions.onEdit?.(message, draft.trim());
            }}
          >
            Ask again
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <UserBubble content={message.content} />
      <div className="flex items-center gap-1">
        <VersionSwitcher message={message} actions={actions} />
        {actions.onEdit !== undefined && (
          <IconButton
            label="Edit this question"
            onClick={() => {
              setEditing(true);
            }}
          >
            <Pencil className="size-3.5" />
          </IconButton>
        )}
      </div>
    </div>
  );
}

function AssistantTurn(props: {
  message: ExploreMessage;
  actions: ExploreTranscriptActions;
}) {
  const { message, actions } = props;
  const [showQuery, setShowQuery] = useState(false);
  const [showTrace, setShowTrace] = useState(false);

  return (
    <div className="space-y-3">
      <MarkdownAnswer>{message.content}</MarkdownAnswer>

      {message.visualization !== null && (
        <div className="rounded-lg border p-3">
          <InteractiveVisualization snapshot={message.visualization} compact />
        </div>
      )}

      {message.preview !== null && message.visualization === null && (
        <PreviewTable preview={message.preview} />
      )}

      {message.caveats.length > 0 && (
        <ul className="space-y-1 text-xs text-muted-foreground">
          {message.caveats.map((caveat) => (
            <li key={caveat}>• {caveat}</li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-1">
        <VersionSwitcher message={message} actions={actions} />
        <CopyButton content={message.content} />
        {actions.onRegenerate !== undefined && (
          <IconButton
            label="Answer again"
            onClick={() => {
              actions.onRegenerate?.(message);
            }}
          >
            <RefreshCw className="size-3.5" />
          </IconButton>
        )}
        {message.queryText !== null && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setShowQuery(!showQuery);
            }}
          >
            {showQuery ? "Hide the query" : "Show the query"}
          </Button>
        )}
        {message.trace.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setShowTrace(!showTrace);
            }}
          >
            {showTrace
              ? "Hide the steps"
              : `Steps (${String(message.trace.length)})`}
          </Button>
        )}
      </div>

      {showQuery && message.queryText !== null && (
        <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs">
          <code>{message.queryText}</code>
        </pre>
      )}

      {showTrace && (
        <ol className="space-y-1 rounded-md border p-3 text-xs text-muted-foreground">
          {message.trace.map((entry, index) => (
            <li key={`${entry.toolName}-${String(index)}`}>
              <span className={entry.ok ? "" : "text-destructive"}>
                {entry.ok ? "✓" : "✕"}
              </span>{" "}
              <span className="font-medium">{entry.toolName}</span> —{" "}
              {entry.message}
            </li>
          ))}
        </ol>
      )}

      {actions.onFollowUp !== undefined && message.followUps.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {message.followUps.map((followUp) => (
            <Button
              key={followUp}
              variant="outline"
              size="sm"
              onClick={() => {
                actions.onFollowUp?.(followUp);
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
 * `‹ 2/3 ›` for a turn that has been edited or regenerated.
 *
 * Hidden entirely when there is only one version, and when the view has no
 * way to switch — the shared page shows a fixed path.
 */
function VersionSwitcher(props: {
  message: ExploreMessage;
  actions: ExploreTranscriptActions;
}) {
  const { message, actions } = props;
  const select = actions.onSelectVersion;
  if (select === undefined || message.versionCount < 2) {
    return null;
  }
  const previous = message.siblingIds[message.versionIndex - 1];
  const next = message.siblingIds[message.versionIndex + 1];
  return (
    <span className="flex items-center gap-0.5 text-xs text-muted-foreground">
      <IconButton
        label="Previous version"
        disabled={previous === undefined}
        onClick={() => {
          if (previous !== undefined) {
            select(previous);
          }
        }}
      >
        <ChevronLeft className="size-3.5" />
      </IconButton>
      {message.versionIndex + 1}/{message.versionCount}
      <IconButton
        label="Next version"
        disabled={next === undefined}
        onClick={() => {
          if (next !== undefined) {
            select(next);
          }
        }}
      >
        <ChevronRight className="size-3.5" />
      </IconButton>
    </span>
  );
}

/** Copy, with the icon standing in for the toast this app does not have. */
function CopyButton(props: { content: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) {
      return;
    }
    const timer = setTimeout(() => {
      setCopied(false);
    }, 2000);
    return () => {
      clearTimeout(timer);
    };
  }, [copied]);

  return (
    <IconButton
      label={copied ? "Copied" : "Copy this answer"}
      onClick={() => {
        void navigator.clipboard.writeText(props.content);
        setCopied(true);
      }}
    >
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
    </IconButton>
  );
}

function IconButton(props: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button
      variant="ghost"
      size="sm"
      className="size-7 p-0"
      aria-label={props.label}
      title={props.label}
      disabled={props.disabled ?? false}
      onClick={props.onClick}
    >
      {props.children}
    </Button>
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
