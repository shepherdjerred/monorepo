import { memo, useEffect, useState } from "react";
import {
  Check,
  ChevronDown,
  Copy,
  MoreHorizontal,
  Pencil,
  RefreshCw,
} from "lucide-react";
import { ReportOutputFormatSchema } from "@scout-for-lol/data";
import { isChartRenderKind } from "@scout-for-lol/data/model/scoutql/catalog-render-kinds.ts";
import type {
  ExploreMessage,
  ExploreTraceEntry,
  VisualizationSnapshot,
} from "@scout-for-lol/data";
import {
  Button,
  IconButton,
} from "@scout-for-lol/design-system/components/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@scout-for-lol/design-system/components/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@scout-for-lol/design-system/components/dropdown-menu";
import { Textarea } from "@scout-for-lol/design-system/components/textarea";
import { InteractiveVisualization } from "#src/components/interactive-visualization.tsx";
import { MarkdownAnswer } from "#src/components/markdown-answer.tsx";
import { ReportResultTable } from "#src/components/report-result-table.tsx";
import { ExploreToolTrace } from "#src/components/explore-tool-trace.tsx";
import { ExploreDareCards } from "#src/components/explore-dare-cards.tsx";
import { ExploreVersionSwitcher } from "#src/components/explore-version-switcher.tsx";
import { ScoutQlCode } from "#src/components/scoutql-code.tsx";
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
  pendingTrace?: ExploreTraceEntry[];
  /** True while a turn is running, so a trailing question is not "interrupted". */
  turnActive?: boolean;
  /** Owner-only raw tool payloads are never offered on the shared route. */
  showRawTrace?: boolean;
  actions?: ExploreTranscriptActions;
  hasError?: boolean;
}) {
  const actions = props.actions ?? EMPTY_ACTIONS;
  const turnActive = props.turnActive ?? false;
  const latestMessageId = props.messages.at(-1)?.id ?? null;
  const stranded = props.hasError
    ? null
    : strandedQuestion(props.messages, turnActive);
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
            <AssistantTurn
              message={message}
              actions={actions}
              showRawTrace={props.showRawTrace ?? false}
              showFollowUps={!turnActive && message.id === latestMessageId}
            />
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
        trace={props.pendingTrace ?? []}
        showRawTrace={props.showRawTrace ?? false}
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
export function strandedQuestion(
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
  trace: ExploreTraceEntry[];
  showRawTrace: boolean;
}) {
  return (
    <div aria-live="polite" className="space-y-6">
      {props.pendingQuestion !== null && (
        <UserBubble content={props.pendingQuestion} />
      )}
      {props.pendingAnswer !== null && (
        <MarkdownAnswer>{props.pendingAnswer}</MarkdownAnswer>
      )}
      {props.showRawTrace && <ExploreDareCards trace={props.trace} />}
      {props.activity !== null && props.trace.length === 0 && (
        <p className="flex items-center gap-2 text-sm text-scout-subtle">
          <span className="inline-block size-2 animate-pulse rounded-full bg-current" />
          {props.activity}
        </p>
      )}
      {props.trace.length > 0 && (
        <Disclosure label={`Steps (${String(props.trace.length)})`}>
          <ExploreToolTrace
            trace={props.trace}
            showRaw={props.showRawTrace}
            live
          />
        </Disclosure>
      )}
    </div>
  );
});

function UserBubble(props: { content: string }) {
  return (
    <div className="flex w-full justify-end">
      <p className="max-w-[80%] rounded-lg bg-scout-hover px-4 py-1.5 text-sm whitespace-pre-wrap">
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
        <ExploreVersionSwitcher
          message={message}
          onSelectVersion={actions.onSelectVersion}
        />
        {actions.onEdit !== undefined && (
          <span className="opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
            <IconButton
              label="Edit this question"
              size="icon-sm"
              variant="ghost"
              title="Edit this question"
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
  showRawTrace: boolean;
  showFollowUps: boolean;
}) {
  const { message, actions } = props;
  const chart = chartableSnapshot(message.visualization);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => {
      setCopied(false);
    }, 2000);
    return () => {
      clearTimeout(timer);
    };
  }, [copied]);

  const handleCopy = () => {
    void navigator.clipboard.writeText(message.content);
    setCopied(true);
  };

  return (
    <div className="space-y-3">
      <MarkdownAnswer>{message.content}</MarkdownAnswer>

      {props.showRawTrace && <ExploreDareCards trace={message.trace} />}

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

      <div className="flex items-center gap-1 pt-1 text-scout-subtle">
        <time
          dateTime={message.createdAt}
          title={TIME_FULL.format(new Date(message.createdAt))}
          className="sr-only"
        >
          {TIME_SHORT.format(new Date(message.createdAt))}
        </time>
        <ExploreVersionSwitcher
          message={message}
          onSelectVersion={actions.onSelectVersion}
        />
        <Button
          variant="ghost"
          size="icon-sm"
          className="size-7 text-scout-subtle hover:text-scout-ink"
          aria-label={copied ? "Copied" : "Copy"}
          title={copied ? "Copied" : "Copy"}
          onClick={handleCopy}
        >
          {copied ? (
            <Check className="size-3.5 text-scout-success" />
          ) : (
            <Copy className="size-3.5" />
          )}
        </Button>
        {actions.onRegenerate !== undefined && (
          <Button
            variant="ghost"
            size="icon-sm"
            className="size-7 text-scout-subtle hover:text-scout-ink"
            aria-label="Answer again"
            title="Answer again"
            onClick={() => {
              actions.onRegenerate?.(message);
            }}
          >
            <RefreshCw className="size-3.5" />
          </Button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              className="size-7 text-scout-subtle hover:text-scout-ink"
              aria-label="More options"
              title="More options"
            >
              <MoreHorizontal className="size-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-44">
            <DropdownMenuLabel className="px-2 py-1 text-xs font-normal text-scout-subtle">
              <time dateTime={message.createdAt}>
                {TIME_FULL.format(new Date(message.createdAt))}
              </time>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="gap-2 text-xs" onClick={handleCopy}>
              <Copy className="size-3.5" />
              Copy
            </DropdownMenuItem>
            {actions.onRegenerate !== undefined && (
              <DropdownMenuItem
                className="gap-2 text-xs"
                onClick={() => {
                  actions.onRegenerate?.(message);
                }}
              >
                <RefreshCw className="size-3.5" />
                Answer again
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {(message.queryText !== null || message.trace.length > 0) && (
        <Disclosure
          label={
            message.queryText !== null && message.trace.length > 0
              ? `ScoutQL query & Steps (${String(message.trace.length)})`
              : message.queryText !== null
                ? "ScoutQL query"
                : `Steps (${String(message.trace.length)})`
          }
        >
          <div className="space-y-3 pt-1">
            {message.queryText !== null && (
              <div className="space-y-1">
                {message.trace.length > 0 && (
                  <h4 className="text-xs font-medium text-scout-subtle">
                    ScoutQL query
                  </h4>
                )}
                <ScoutQlCode queryText={message.queryText} />
              </div>
            )}
            {message.trace.length > 0 && (
              <div className="space-y-1">
                {message.queryText !== null && (
                  <h4 className="text-xs font-medium text-scout-subtle">
                    Steps ({String(message.trace.length)})
                  </h4>
                )}
                <ExploreToolTrace
                  trace={message.trace}
                  showRaw={props.showRawTrace}
                />
              </div>
            )}
          </div>
        </Disclosure>
      )}

      {props.showFollowUps &&
        actions.onFollowUp !== undefined &&
        message.followUps.length > 0 && (
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
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded py-0.5 px-1.5 text-xs text-scout-subtle hover:text-scout-ink hover:bg-scout-surface transition-colors group"
        >
          <span>{props.label}</span>
          <ChevronDown
            className="size-3 text-scout-subtle transition-transform group-data-[state=open]:rotate-180"
            aria-hidden="true"
          />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>{props.children}</CollapsibleContent>
    </Collapsible>
  );
}

/**
 * A snapshot only when the query actually asked to be drawn.
 *
 * The engine builds a visualization snapshot for every result regardless of
 * render kind, so `visualization !== null` is not the question — `RENDER
 * table` produces one too. The catalog knows which kinds are charts; drawing
 * one for a table turns a two-row answer into a graph nobody asked for.
 *
 * `kind` is a free string in the stored snapshot schema, and shares written
 * before the v2 cutover carry the lowercase token rather than the render
 * format, so it is upper-cased before being recognized. An unrecognized kind
 * is not drawn — a snapshot from a future render kind is data this build has
 * no chart for.
 */
function chartableSnapshot(
  snapshot: VisualizationSnapshot | null,
): VisualizationSnapshot | null {
  if (snapshot === null) {
    return null;
  }
  const format = ReportOutputFormatSchema.safeParse(
    snapshot.kind.toUpperCase(),
  );
  return format.success && isChartRenderKind(format.data) ? snapshot : null;
}
