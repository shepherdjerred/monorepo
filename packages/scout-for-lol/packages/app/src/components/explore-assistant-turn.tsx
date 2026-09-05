import { memo, useEffect, useState } from "react";
import { Check, Copy, MoreHorizontal, RefreshCw } from "lucide-react";
import type { ExploreMessage } from "@scout-for-lol/data";
import { Button } from "@scout-for-lol/design-system/components/button";
import { Disclosure } from "#src/components/explore-disclosure.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@scout-for-lol/design-system/components/dropdown-menu";
import { MarkdownAnswer } from "#src/components/markdown-answer.tsx";
import { ExploreToolTrace } from "#src/components/explore-tool-trace.tsx";
import { ExploreDareCards } from "#src/components/explore-dare-cards.tsx";
import { ExploreVersionSwitcher } from "#src/components/explore-version-switcher.tsx";
import { ScoutQlCode } from "#src/components/scoutql-code.tsx";
import { ExploreVisualResult } from "#src/components/explore-visual-result.tsx";
import type { ExploreTranscriptActions } from "#src/components/explore-transcript-actions.ts";

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

function AssistantTurnActionBar(props: {
  readonly message: ExploreMessage;
  readonly actions: ExploreTranscriptActions;
  readonly copied: boolean;
  readonly onCopy: () => void;
}) {
  const { message, actions, copied, onCopy } = props;
  return (
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
        onClick={onCopy}
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
          <DropdownMenuItem className="gap-2 text-xs" onClick={onCopy}>
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
  );
}

function evidenceLabel(queryText: string | null, traceLength: number): string {
  if (queryText !== null && traceLength > 0) {
    return `ScoutQL query & Steps (${String(traceLength)})`;
  }
  if (queryText === null) {
    return `Steps (${String(traceLength)})`;
  }
  return "ScoutQL query";
}

function AssistantTurnEvidence(props: {
  readonly message: ExploreMessage;
  readonly showRawTrace: boolean;
}) {
  const { message, showRawTrace } = props;
  if (message.queryText === null && message.trace.length === 0) {
    return null;
  }
  return (
    <Disclosure label={evidenceLabel(message.queryText, message.trace.length)}>
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
            <ExploreToolTrace trace={message.trace} showRaw={showRawTrace} />
          </div>
        )}
      </div>
    </Disclosure>
  );
}

export const AssistantTurn = memo(function AssistantTurnView(props: {
  readonly message: ExploreMessage;
  readonly actions: ExploreTranscriptActions;
  readonly showRawTrace: boolean;
  readonly showFollowUps: boolean;
}) {
  const { message, actions } = props;
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

      <ExploreVisualResult message={message} onFollowUp={actions.onFollowUp} />

      {message.caveats.length > 0 && (
        <ul className="space-y-1 rounded-md border-l-2 border-scout-border bg-scout-surface py-2 pr-3 pl-3 text-xs">
          {message.caveats.map((caveat) => (
            <li key={caveat}>{caveat}</li>
          ))}
        </ul>
      )}

      <AssistantTurnActionBar
        message={message}
        actions={actions}
        copied={copied}
        onCopy={handleCopy}
      />

      <AssistantTurnEvidence
        message={message}
        showRawTrace={props.showRawTrace}
      />

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
