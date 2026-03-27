import { useState, useEffect, useRef } from "react";
import { z } from "zod";
import { MessageBubble } from "@/components/message-bubble";
import { Badge } from "@/components/ui/badge";
import { ChevronDown, ChevronRight } from "lucide-react";

type ConversationEntry = {
  timestamp: string;
  sessionId: string;
  agent: string;
  jobId: string;
  role: string;
  content: string;
  toolName?: string | undefined;
  toolInput?: string | undefined;
  toolUseId?: string | undefined;
  permissionDecision?: string | undefined;
  turnNumber: number;
  model?: string | undefined;
  tokenUsage?: { input: number; output: number } | undefined;
  durationMs?: number | undefined;
  metadata?: Record<string, unknown> | undefined;
};

const SessionSummarySchema = z.object({
  totalTurns: z.number(),
  totalInputTokens: z.number(),
  totalOutputTokens: z.number(),
  durationMs: z.number(),
  outcome: z.string(),
  totalCostUsd: z.number().optional(),
  durationApiMs: z.number().optional(),
  modelUsage: z
    .record(
      z.string(),
      z.object({
        inputTokens: z.number(),
        outputTokens: z.number(),
        cacheReadInputTokens: z.number(),
        cacheCreationInputTokens: z.number(),
        costUsd: z.number(),
      }),
    )
    .optional(),
  permissionDenials: z
    .array(
      z.object({
        toolName: z.string(),
        toolInput: z.string(),
      }),
    )
    .optional(),
  systemPrompt: z.string().optional(),
});

type SessionSummary = z.infer<typeof SessionSummarySchema>;

type ConversationViewerProps = {
  entries: ConversationEntry[];
};

function parseSummary(entries: ConversationEntry[]): SessionSummary | null {
  const summaryEntry = entries.find(
    (e) => e.role === "system" && e.metadata?.type === "summary",
  );
  if (summaryEntry == null) return null;
  try {
    const parsed: unknown = JSON.parse(summaryEntry.content);
    const result = SessionSummarySchema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

function formatCost(usd: number): string {
  return `$${usd.toFixed(4)}`;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${String(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60_000);
  const secs = Math.floor((ms % 60_000) / 1000);
  return `${String(mins)}m ${String(secs)}s`;
}

function SummaryHeader({ summary }: { summary: SessionSummary }) {
  const [showPrompt, setShowPrompt] = useState(false);

  return (
    <div className="mb-4 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-900">
      <div className="flex flex-wrap items-center gap-4 text-sm">
        <Badge variant={summary.outcome === "completed" ? "success" : "error"}>
          {summary.outcome}
        </Badge>
        <span className="text-zinc-600 dark:text-zinc-400">
          {summary.totalTurns} turns
        </span>
        {summary.totalCostUsd != null && (
          <span className="font-mono text-zinc-600 dark:text-zinc-400">
            {formatCost(summary.totalCostUsd)}
          </span>
        )}
        <span className="font-mono text-xs text-zinc-500">
          {summary.totalInputTokens.toLocaleString()} in /{" "}
          {summary.totalOutputTokens.toLocaleString()} out
        </span>
        <span className="text-zinc-500">
          {formatDuration(summary.durationMs)}
        </span>
        {summary.durationApiMs != null && (
          <span className="text-xs text-zinc-400">
            (API: {formatDuration(summary.durationApiMs)})
          </span>
        )}
        {summary.permissionDenials != null &&
          summary.permissionDenials.length > 0 && (
            <Badge variant="warning">
              {summary.permissionDenials.length} denied
            </Badge>
          )}
      </div>

      {summary.modelUsage != null &&
        Object.keys(summary.modelUsage).length > 0 && (
          <div className="mt-3 border-t border-zinc-100 pt-3 dark:border-zinc-800">
            <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
              Model Usage
            </div>
            <div className="mt-1 space-y-1">
              {Object.entries(summary.modelUsage).map(([model, usage]) => (
                <div
                  key={model}
                  className="flex items-center gap-3 text-xs text-zinc-600 dark:text-zinc-400"
                >
                  <span className="font-mono">{model}</span>
                  <span>
                    {usage.inputTokens.toLocaleString()} in /{" "}
                    {usage.outputTokens.toLocaleString()} out
                  </span>
                  {usage.cacheReadInputTokens > 0 && (
                    <span className="text-zinc-400">
                      ({usage.cacheReadInputTokens.toLocaleString()} cached)
                    </span>
                  )}
                  <span className="font-mono">{formatCost(usage.costUsd)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

      {summary.systemPrompt != null && (
        <div className="mt-3 border-t border-zinc-100 pt-3 dark:border-zinc-800">
          <button
            onClick={() => {
              setShowPrompt(!showPrompt);
            }}
            className="flex items-center gap-1 text-xs font-medium text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
          >
            {showPrompt ? (
              <ChevronDown size={12} />
            ) : (
              <ChevronRight size={12} />
            )}
            System Prompt
          </button>
          {showPrompt && (
            <pre className="mt-2 max-h-60 overflow-auto rounded bg-zinc-100 p-3 text-xs dark:bg-zinc-800">
              {summary.systemPrompt}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

function SummaryFooter({ summary }: { summary: SessionSummary }) {
  return (
    <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-2 text-xs text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400">
      <Badge
        variant={summary.outcome === "completed" ? "success" : "error"}
        className="text-xs"
      >
        {summary.outcome}
      </Badge>
      <span>{summary.totalTurns} turns</span>
      <span className="font-mono">
        {summary.totalInputTokens.toLocaleString()} in /{" "}
        {summary.totalOutputTokens.toLocaleString()} out
      </span>
      {summary.totalCostUsd != null && (
        <span className="font-mono">{formatCost(summary.totalCostUsd)}</span>
      )}
      <span>{formatDuration(summary.durationMs)}</span>
    </div>
  );
}

export function ConversationViewer({ entries }: ConversationViewerProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [entries.length]);

  const first = entries[0];
  if (first == null) {
    return (
      <p className="py-8 text-center text-sm text-zinc-500">
        No entries in this conversation.
      </p>
    );
  }

  const summary = parseSummary(entries);

  // Filter out system entries from the message list (they're shown in header/footer)
  const messageEntries = entries.filter(
    (e) =>
      !(
        e.role === "system" &&
        (e.metadata?.type === "summary" || e.metadata?.type === "system_prompt")
      ),
  );

  const totalTurns = Math.max(...entries.map((e) => e.turnNumber));

  return (
    <div className="flex h-full flex-col">
      <div className="mb-4 flex items-center gap-3 border-b border-zinc-200 pb-3 dark:border-zinc-800">
        <Badge variant="info">{first.agent}</Badge>
        <span className="font-mono text-xs text-zinc-500">{first.jobId}</span>
        <span className="text-xs text-zinc-500">
          {totalTurns} turn{totalTurns === 1 ? "" : "s"}
        </span>
      </div>

      {summary != null && <SummaryHeader summary={summary} />}

      <div className="flex-1 space-y-3 overflow-auto">
        {messageEntries.map((entry, i) => (
          <MessageBubble key={i} entry={entry} />
        ))}
        <div ref={bottomRef} />
      </div>

      {summary != null && <SummaryFooter summary={summary} />}
    </div>
  );
}
