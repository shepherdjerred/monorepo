import { useRef, useState, type Dispatch, type SetStateAction } from "react";
import { AlertCircle, Check, Square, WandSparkles } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import {
  DiscordGuildIdSchema,
  REPORT_DEFAULT_LOOKBACK_DAYS,
  REPORT_DEFAULT_MAX_ROWS,
  type ReportAiEditStatus,
  type ReportAiFinalDraft,
  type ReportAiPreviewSummary,
  type ReportAiStreamEvent,
} from "@scout-for-lol/data";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "#src/components/ui/card.tsx";
import { Button } from "#src/components/ui/button.tsx";
import { Badge } from "#src/components/ui/badge.tsx";
import { Textarea } from "#src/components/ui/textarea.tsx";
import { useTRPC } from "#src/lib/trpc.ts";
import { streamReportAiEdit } from "#src/lib/report-ai-stream.ts";
import { type ReportFormState } from "#src/components/report-form-fields.tsx";
import { ReportQueryViewer } from "#src/components/report-query-viewer.tsx";

type ProgressItem = {
  id: string;
  label: string;
  tone: "default" | "success" | "error";
};

export function ReportAiEditor(props: {
  guildId: string;
  state: ReportFormState;
  setState: Dispatch<SetStateAction<ReportFormState>>;
}) {
  const trpc = useTRPC();
  const abortRef = useRef<AbortController | null>(null);
  const [instructions, setInstructions] = useState("");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<ProgressItem[]>([]);
  const [draftText, setDraftText] = useState("");
  const [finalDraft, setFinalDraft] = useState<ReportAiFinalDraft | null>(null);
  const [preview, setPreview] = useState<ReportAiPreviewSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  const statusQuery = useQuery(
    trpc.report.aiEditStatus.queryOptions({ guildId: props.guildId }),
  );
  const status = statusQuery.data;
  const quota = weeklyQuota(status);
  const exhausted = status?.quota.find((snapshot) => snapshot.remaining === 0);
  const disabledReason = statusDisabledReason(status);
  const canRun =
    status?.enabled === true &&
    !status.activeRun &&
    instructions.trim().length > 0 &&
    !running;

  async function startEdit() {
    const trimmed = instructions.trim();
    if (trimmed.length === 0) {
      setError("Describe the report first.");
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);
    setError(null);
    setProgress([]);
    setDraftText("");
    setFinalDraft(null);
    setPreview(null);

    try {
      const guildId = DiscordGuildIdSchema.parse(props.guildId);
      await streamReportAiEdit({
        input: {
          guildId,
          instructions: trimmed,
          currentQueryText:
            props.state.queryText.trim().length === 0
              ? null
              : props.state.queryText,
          currentTitle:
            props.state.title.trim().length === 0 ? null : props.state.title,
          currentDescription:
            props.state.description.trim().length === 0
              ? null
              : props.state.description,
          lookbackDays: numberOr(
            props.state.lookbackDays,
            REPORT_DEFAULT_LOOKBACK_DAYS,
          ),
          maxRows: numberOr(props.state.maxRows, REPORT_DEFAULT_MAX_ROWS),
          sourceCompetitionId: null,
        },
        signal: controller.signal,
        onEvent: handleStreamEvent,
      });
    } catch (streamError) {
      setError(
        controller.signal.aborted
          ? "AI edit was cancelled."
          : errorMessage(streamError),
      );
    } finally {
      setRunning(false);
      abortRef.current = null;
      void statusQuery.refetch();
    }
  }

  function handleStreamEvent(event: ReportAiStreamEvent) {
    switch (event.type) {
      case "started": {
        appendProgress("AI edit started.", "default");
        break;
      }
      case "step_started": {
        appendProgress(event.message, "default");
        break;
      }
      case "tool_call": {
        appendProgress(event.message, "default");
        break;
      }
      case "tool_result": {
        appendProgress(event.message, event.ok ? "success" : "error");
        break;
      }
      case "preview": {
        setPreview(event.preview);
        appendProgress("Preview loaded.", "success");
        break;
      }
      case "draft_delta": {
        setDraftText((prev) => prev + event.text);
        break;
      }
      case "final": {
        setFinalDraft(event.draft);
        appendProgress("Draft ready.", "success");
        void statusQuery.refetch();
        break;
      }
      case "error": {
        setError(event.message);
        appendProgress(event.message, "error");
        break;
      }
      case "done": {
        break;
      }
    }
  }

  function appendProgress(label: string, tone: ProgressItem["tone"]) {
    setProgress((prev) =>
      [...prev, { id: globalThis.crypto.randomUUID(), label, tone }].slice(-12),
    );
  }

  function applyDraft() {
    if (finalDraft === null) {
      return;
    }
    props.setState((prev) => ({
      ...prev,
      title: finalDraft.title,
      description: finalDraft.description ?? "",
      queryText: finalDraft.queryText,
    }));
  }

  function cancelEdit() {
    abortRef.current?.abort();
  }

  return (
    <Card>
      <CardHeader className="space-y-3 pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-sm">AI editor</CardTitle>
          <QuotaBadge quota={quota} />
        </div>
        {exhausted !== undefined && (
          <p className="text-xs text-muted-foreground">
            {exhausted.window} quota resets {formatReset(exhausted.resetsAt)}.
          </p>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        <Textarea
          value={instructions}
          onChange={(event) => {
            setInstructions(event.target.value);
          }}
          placeholder="Report request"
          disabled={running}
          className="min-h-[96px]"
        />

        {disabledReason !== null && (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <AlertCircle className="size-4" />
            {disabledReason}
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            disabled={!canRun}
            onClick={() => {
              void startEdit();
            }}
          >
            <WandSparkles />
            Edit
          </Button>
          {running && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={cancelEdit}
            >
              <Square />
              Stop
            </Button>
          )}
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={finalDraft === null}
            onClick={applyDraft}
          >
            <Check />
            Apply draft
          </Button>
        </div>

        {progress.length > 0 && (
          <div className="space-y-1 rounded-md border border-border p-3">
            {progress.map((item) => (
              <p key={item.id} className={progressClassName(item.tone)}>
                {item.label}
              </p>
            ))}
          </div>
        )}

        {preview !== null && (
          <div className="rounded-md border border-border p-3 text-xs">
            <p className="font-medium">
              Preview: {preview.rows.length.toString()} rows,{" "}
              {preview.rowsScanned.toString()} scanned
            </p>
            <p className="mt-1 text-muted-foreground">
              {preview.columns.join(", ")}
            </p>
          </div>
        )}

        {draftText.length > 0 && finalDraft === null && (
          <pre className="max-h-[160px] overflow-auto whitespace-pre-wrap rounded-md bg-muted/50 p-3 text-xs">
            {draftText}
          </pre>
        )}

        {finalDraft !== null && (
          <div className="space-y-2 rounded-md border border-border p-3">
            <div>
              <p className="text-sm font-medium">{finalDraft.title}</p>
              {finalDraft.description !== null && (
                <p className="text-xs text-muted-foreground">
                  {finalDraft.description}
                </p>
              )}
            </div>
            <ReportQueryViewer queryText={finalDraft.queryText} />
            <p className="text-xs text-muted-foreground">
              {finalDraft.explanation}
            </p>
            {finalDraft.warnings.length > 0 && (
              <ul className="space-y-1 text-xs text-muted-foreground">
                {finalDraft.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        {error !== null && <p className="text-sm text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}

function QuotaBadge(props: {
  quota: ReportAiEditStatus["quota"][number] | undefined;
}) {
  if (props.quota === undefined) {
    return <Badge variant="outline">Quota loading</Badge>;
  }
  return (
    <Badge variant="outline">
      Weekly quota: {props.quota.remaining.toString()} /{" "}
      {props.quota.limit.toString()}
    </Badge>
  );
}

function weeklyQuota(
  status: ReportAiEditStatus | undefined,
): ReportAiEditStatus["quota"][number] | undefined {
  return status?.quota.find(
    (snapshot) => snapshot.scope === "user_guild" && snapshot.window === "week",
  );
}

function statusDisabledReason(
  status: ReportAiEditStatus | undefined,
): string | null {
  if (status === undefined) {
    return null;
  }
  if (!status.enabled) {
    return status.disabledReason;
  }
  if (status.activeRun) {
    return "An AI edit is already running.";
  }
  return null;
}

function progressClassName(tone: ProgressItem["tone"]): string {
  if (tone === "success") {
    return "text-xs text-emerald-700 dark:text-emerald-400";
  }
  if (tone === "error") {
    return "text-xs text-destructive";
  }
  return "text-xs text-muted-foreground";
}

function numberOr(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function formatReset(resetsAt: string): string {
  return new Date(resetsAt).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
