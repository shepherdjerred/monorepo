import { memo, useEffect, useState } from "react";
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  Pencil,
  RefreshCw,
} from "lucide-react";
import { REPORT_RENDER_KINDS } from "@scout-for-lol/data";
import type {
  ExploreMessage,
  VisualizationSnapshot,
} from "@scout-for-lol/data";
import { Button } from "@scout-for-lol/design-system/components/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@scout-for-lol/design-system/components/collapsible";
import { Textarea } from "@scout-for-lol/design-system/components/textarea";
import { InteractiveVisualization } from "#src/components/interactive-visualization.tsx";
import { MarkdownAnswer } from "#src/components/markdown-answer.tsx";
import { ReportResultTable } from "#src/components/report-result-table.tsx";
import {
  SingleRowResult,
  isUngroupedResult,
} from "#src/components/explore-result.tsx";

/**
 * Renders one path through an explore conversation.
 *
 * Used by both the live page and the read-only shared page, which is what
 * keeps a shared link looking like what the asker saw. The prose is the
 * answer; the chart and table support it; the ScoutQL and the tool trace are
 * evidence, collapsed by default so they do not compete with the answer.
 *
 * Actions are opt-in per callback, so the shared view gets the same rendering
 * with none of the controls simply by passing none of them. The turns are
 * memoized and the streaming turn renders in its own leaf, so a token
 * arriving re-renders one small component rather than every prior message.
 */
export type ExploreTranscriptActions = {
  onFollowUp?: (question: string) => void;
  onEdit?: (message: ExploreMessage, question: string) => void;
  onRegenerate?: (message: ExploreMessage) => void;
  onSelectVersion?: (messageId: string) => void;
  /** Answer a question that never got one — see {@link InterruptedTurn}. */
  onRetry?: (question: ExploreMessage) => void;
};

/** Stable identity so memoized turns don't re-render on the shared page. */
const EMPTY_ACTIONS: ExploreTranscriptActions = {};

export function ExploreTranscript(props: {
  messages: ExploreMessage[];
  /** Prose streaming in for a turn that has not been persisted yet. */
  pendingAnswer?: string | null;
  pendingQuestion?: string | null;
  activity?: string | null;
  /** True while a turn is running, so a trailing question is not "interrupted". */
  turnActive?: boolean;
  actions?: ExploreTranscriptActions;
}) {
  const actions = props.actions ?? EMPTY_ACTIONS;
  const stranded = strandedQuestion(props.messages, props.turnActive ?? false);
  return (
    <div role="log" aria-label="Conversation">
      {/* Spacing carries the grouping: an answer sits close to the question it
          belongs to, and the next exchange starts well clear of it. A uniform
          gap made every message look equally (un)related to its neighbours. */}
      {props.messages.map((message) =>
        message.role === "user" ? (
          <div key={message.id} className="mt-10 first:mt-0">
            <UserTurn message={message} actions={actions} />
          </div>
        ) : (
          <div key={message.id} className="mt-3">
            <AssistantTurn message={message} actions={actions} />
          </div>
        ),
      )}

      {stranded !== null && (
        <div className="mt-3">
          <InterruptedTurn question={stranded} actions={actions} />
        </div>
      )}

      <PendingTurn
        pendingQuestion={props.pendingQuestion ?? null}
        pendingAnswer={props.pendingAnswer ?? null}
        activity={props.activity ?? null}
      />
    </div>
  );
}

/**
 * The question a turn never answered, or null when there isn't one.
 *
 * A turn abandoned before it streamed any prose salvages nothing — that is
 * deliberate ("only a turn that said nothing salvages nothing"), so no refetch
 * will ever fill the gap. Without this the reader is left with their own
 * question, no answer, no error and no way forward, which reads as the page
 * being broken rather than as an interruption. Switching conversations
 * mid-turn is the ordinary way to reach it.
 */
function strandedQuestion(
  messages: ExploreMessage[],
  turnActive: boolean,
): ExploreMessage | null {
  if (turnActive) {
    return null;
  }
  const last = messages.at(-1);
  return last?.role === "user" ? last : null;
}

function InterruptedTurn(props: {
  question: ExploreMessage;
  actions: ExploreTranscriptActions;
}) {
  const retry = props.actions.onRetry;
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-dashed border-scout-border px-3 py-2 text-sm text-scout-subtle">
      <span>This question was interrupted before it was answered.</span>
      {retry !== undefined && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            retry(props.question);
          }}
        >
          Answer it
        </Button>
      )}
    </div>
  );
}

/**
 * The streaming turn. Its own memoized leaf so per-token updates re-render
 * only this, and a live region so assistive tech announces the answer as it
 * arrives — the region stays mounted even when idle, because screen readers
 * only announce additions to a region they registered before content came.
 */
const PendingTurn = memo(function PendingTurnView(props: {
  pendingQuestion: string | null;
  pendingAnswer: string | null;
  activity: string | null;
}) {
  return (
    <div aria-live="polite" className="space-y-6">
      {props.pendingQuestion !== null && (
        <UserBubble content={props.pendingQuestion} />
      )}
      {props.pendingAnswer !== null && (
        <MarkdownAnswer>{props.pendingAnswer}</MarkdownAnswer>
      )}
      {props.activity !== null && (
        <p className="flex items-center gap-2 text-sm text-scout-subtle">
          <span className="inline-block size-2 animate-pulse rounded-full bg-current" />
          {props.activity}
        </p>
      )}
    </div>
  );
});

function UserBubble(props: { content: string }) {
  return (
    <div className="flex justify-end">
      <p className="max-w-[80%] rounded-lg bg-scout-hover px-3 py-2 text-sm whitespace-pre-wrap">
        {props.content}
      </p>
    </div>
  );
}

const UserTurn = memo(function UserTurnView(props: {
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
    // `group` + focus-within, not hover alone: the controls must still be
    // reachable by keyboard. Previously the pencil sat permanently in its own
    // band of empty space under every question, reading as a stray element.
    <div className="group flex flex-col items-end gap-1">
      <UserBubble content={message.content} />
      <div className="flex items-center gap-1">
        {/* Always visible: it is the only signal that other versions of this
            question exist, so hiding it until hover would hide the feature. */}
        <VersionSwitcher message={message} actions={actions} />
        {actions.onEdit !== undefined && (
          <span className="opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
            <IconButton
              label="Edit this question"
              onClick={() => {
                setEditing(true);
              }}
            >
              <Pencil className="size-3.5" />
            </IconButton>
          </span>
        )}
      </div>
    </div>
  );
});

const AssistantTurn = memo(function AssistantTurnView(props: {
  message: ExploreMessage;
  actions: ExploreTranscriptActions;
}) {
  const { message, actions } = props;
  const chart = chartableSnapshot(message.visualization);

  return (
    <div className="space-y-3">
      <MarkdownAnswer>{message.content}</MarkdownAnswer>

      {chart !== null && (
        // Not `compact` — that pins the chart to 180px, which is a preview
        // thumbnail height and squashes a multi-category chart in a
        // full-width transcript. The component draws its own border, so this
        // wrapper adds none.
        <InteractiveVisualization snapshot={chart} />
      )}

      {chart === null &&
        message.preview !== null &&
        message.preview.rows.length > 0 &&
        // Empty previews render nothing at all — the prose already says "no
        // rows", and the shared table's empty-state box would restate it.
        (isUngroupedResult(message.preview) ? (
          <SingleRowResult preview={message.preview} />
        ) : (
          <ReportResultTable
            columns={message.preview.columns}
            rows={message.preview.rows}
          />
        ))}

      {message.caveats.length > 0 && (
        // Caveats are what stop a reader quoting a number that does not mean
        // what they think it means, so they get a marked-out block rather than
        // the faintest text on screen. Uses the shared design-system tokens
        // this file was migrated onto, not the retired muted-* ones.
        <ul className="space-y-1 rounded-md border-l-2 border-scout-border bg-scout-surface py-2 pr-3 pl-3 text-xs">
          {message.caveats.map((caveat) => (
            <li key={caveat}>{caveat}</li>
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
        <time
          dateTime={message.createdAt}
          title={TIME_FULL.format(new Date(message.createdAt))}
          className="ml-auto text-xs text-scout-subtle"
        >
          {TIME_SHORT.format(new Date(message.createdAt))}
        </time>
      </div>

      {message.queryText !== null && (
        <Disclosure label="ScoutQL query">
          <pre className="overflow-x-auto rounded-md bg-scout-hover p-3 text-xs">
            <code>{message.queryText}</code>
          </pre>
        </Disclosure>
      )}

      {message.trace.length > 0 && (
        <Disclosure label={`Steps (${String(message.trace.length)})`}>
          <ol className="space-y-1 rounded-md border p-3 text-xs text-scout-subtle">
            {message.trace.map((entry, index) => (
              <li key={`${entry.toolName}-${String(index)}`}>
                <span className={entry.ok ? "" : "text-scout-danger"}>
                  {entry.ok ? "✓" : "✕"}
                </span>{" "}
                <span className="font-medium">{entry.toolName}</span> —{" "}
                {entry.message}
              </li>
            ))}
          </ol>
        </Disclosure>
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
});

// Assistant turns show when each exchange happened; one stamp per exchange,
// since the question sits directly above its answer. Hover for the full date.
const TIME_FULL = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
});
const TIME_SHORT = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

/**
 * Collapsed-by-default evidence. Radix supplies `aria-expanded`/`aria-controls`
 * on the trigger, which the old hand-rolled show/hide buttons never had.
 */
function Disclosure(props: { label: string; children: React.ReactNode }) {
  return (
    <Collapsible className="space-y-2">
      <CollapsibleTrigger asChild>
        <Button variant="ghost" size="sm" className="group gap-1">
          {props.label}
          <ChevronDown
            className="size-3.5 text-scout-subtle transition-transform group-data-[state=open]:rotate-180"
            aria-hidden="true"
          />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>{props.children}</CollapsibleContent>
    </Collapsible>
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
    // Bordered and in body colour: as faint muted text this was routinely
    // missed, and a reader who cannot see that an answer has versions has no
    // way to know the other one exists.
    <span className="flex items-center gap-0.5 rounded-md border border-scout-border px-1 text-xs">
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
      <span className="tabular-nums">
        {message.versionIndex + 1}/{message.versionCount}
      </span>
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
 * A snapshot only when the query actually asked to be drawn.
 *
 * The engine builds a visualization snapshot for every result regardless of
 * render kind, so `visualization !== null` is not the question — `RENDER
 * table` produces one too. The registry knows which kinds are charts; drawing
 * one for a table turns a two-row answer into a graph nobody asked for.
 */
function chartableSnapshot(
  snapshot: VisualizationSnapshot | null,
): VisualizationSnapshot | null {
  if (snapshot === null) {
    return null;
  }
  const kind = REPORT_RENDER_KINDS.find((entry) => entry.id === snapshot.kind);
  return kind?.isChart === true ? snapshot : null;
}
