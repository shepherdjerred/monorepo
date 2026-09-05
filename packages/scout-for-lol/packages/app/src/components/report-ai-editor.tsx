import { useRef, useState } from "react";
import { AlertCircle, Check, Square, WandSparkles } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  DiscordGuildIdSchema,
  type ReportAiEditStatus,
  type ReportAiFinalDraft,
  type ReportAiPreviewSummary,
  type ReportAiQuotaSnapshot,
  type ReportAiStreamEvent,
} from "@scout-for-lol/data";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@scout-for-lol/design-system/components/card";
import { Button } from "@scout-for-lol/design-system/components/button";
import { Badge } from "@scout-for-lol/design-system/components/badge";
import { useTRPC } from "#src/lib/trpc.ts";
import { track } from "#src/lib/analytics.ts";
import { streamReportAiEdit } from "#src/lib/report-ai-stream.ts";
import { type ReportFormState } from "#src/components/report-form-fields.tsx";
import { ReportQueryViewer } from "#src/components/report-query-viewer.tsx";
import { ReportResultTable } from "#src/components/report-result-table.tsx";
import {
  focusFirstInvalid,
  FormPendingStatus,
  handleFormSubmit,
  submitThenChangeValidation,
  useScoutForm,
} from "#src/components/semantic-form.tsx";
import { ReportAiInstructionsFormSchema } from "#src/lib/form-schemas.ts";

type ProgressItem = {
  id: string;
  label: string;
  tone: "default" | "success" | "error";
};

export function ReportAiEditor(props: {
  guildId: string;
  state: ReportFormState;
  onApplyDraft: (draft: {
    title: string;
    description: string;
    queryText: string;
  }) => void;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const abortRef = useRef<AbortController | null>(null);
  const formElement = useRef<HTMLFormElement>(null);
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
  const disabledReason = statusDisabledReason(status);
  const canRun = status?.enabled === true && !status.activeRun && !running;

  async function startEdit(instructions: string) {
    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);
    setError(null);
    setProgress([]);
    setDraftText("");
    setFinalDraft(null);
    setPreview(null);
    track("ai_edit_started", {
      has_existing_query: props.state.queryText.trim().length > 0,
    });

    try {
      const guildId = DiscordGuildIdSchema.parse(props.guildId);
      await streamReportAiEdit({
        input: {
          guildId,
          instructions,
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
          sourceCompetitionId: null,
        },
        signal: controller.signal,
        onEvent: handleStreamEvent,
      });
    } catch (streamError) {
      if (controller.signal.aborted) {
        setError("AI edit was cancelled.");
      } else {
        setError(errorMessage(streamError));
        track("ai_edit_error", { reason: "stream" });
      }
    } finally {
      setRunning(false);
      abortRef.current = null;
      void queryClient.invalidateQueries({
        queryKey: trpc.report.aiEditStatus.pathKey(),
      });
    }
  }

  const form = useScoutForm({
    defaultValues: { instructions: "" },
    validationLogic: submitThenChangeValidation,
    validators: { onDynamic: ReportAiInstructionsFormSchema },
    onSubmit: async ({ value }) => {
      if (!canRun) return;
      const parsed = ReportAiInstructionsFormSchema.parse(value);
      await startEdit(parsed.instructions);
    },
    onSubmitInvalid: () => {
      focusFirstInvalid(formElement.current);
    },
  });
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
        void queryClient.invalidateQueries({
          queryKey: trpc.report.aiEditStatus.pathKey(),
        });
        break;
      }
      case "error": {
        setError(event.message);
        appendProgress(event.message, "error");
        track("ai_edit_error", { reason: "server" });
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
    track("ai_edit_applied");
    props.onApplyDraft({
      title: finalDraft.title,
      description: finalDraft.description ?? "",
      queryText: finalDraft.queryText,
    });
  }

  function cancelEdit() {
    track("ai_edit_cancelled");
    abortRef.current?.abort();
  }

  return (
    <Card>
      <CardHeader className="space-y-3 pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-sm">AI editor</CardTitle>
          {status?.exempt === true && (
            <Badge variant="outline">Unlimited (admin)</Badge>
          )}
        </div>
        <QuotaSummary status={status} />
      </CardHeader>
      <CardContent>
        <form.AppForm>
          <form
            ref={formElement}
            className="space-y-3"
            aria-busy={running}
            onSubmit={(event) => {
              handleFormSubmit(event, () => form.handleSubmit());
            }}
          >
            <fieldset disabled={running} className="m-0 border-0 p-0">
              <form.AppField name="instructions">
                {(field) => (
                  <field.TextareaField
                    id="report-ai-instructions"
                    label="Describe the report you want"
                    maxLength={4000}
                    placeholder="Compare ranked win rate and KDA over the last 30 days"
                    autoComplete="off"
                    className="min-h-[96px]"
                    required
                  />
                )}
              </form.AppField>
            </fieldset>

            {disabledReason !== null && (
              <p className="flex items-center gap-2 text-xs text-scout-subtle">
                <AlertCircle className="size-4" />
                {disabledReason}
              </p>
            )}

            <div className="flex flex-wrap gap-2">
              <Button type="submit" size="sm" disabled={!canRun}>
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
            <FormPendingStatus pending={running}>
              Generating report draft…
            </FormPendingStatus>

            {progress.length > 0 && (
              <div className="space-y-1 rounded-md border border-border p-3">
                {progress.map((item) => (
                  <p key={item.id} className={progressClassName(item.tone)}>
                    {item.label}
                  </p>
                ))}
              </div>
            )}
          </form>
        </form.AppForm>

        {preview !== null && (
          <div className="space-y-2">
            <p className="text-xs font-medium">Draft preview</p>
            <ReportResultTable columns={preview.columns} rows={preview.rows} />
            <p className="text-xs text-scout-subtle">
              {preview.rows.length.toString()} row(s) ·{" "}
              {preview.rowsScanned.toLocaleString()} fact row(s) scanned
            </p>
          </div>
        )}

        {draftText.length > 0 && finalDraft === null && (
          <pre className="max-h-[160px] overflow-auto whitespace-pre-wrap rounded-md bg-scout-hover/50 p-3 text-xs">
            {draftText}
          </pre>
        )}

        {finalDraft !== null && (
          <div className="space-y-2 rounded-md border border-border p-3">
            <div>
              <p className="text-sm font-medium">{finalDraft.title}</p>
              {finalDraft.description !== null && (
                <p className="text-xs text-scout-subtle">
                  {finalDraft.description}
                </p>
              )}
            </div>
            <ReportQueryViewer queryText={finalDraft.queryText} />
            <p className="text-xs text-scout-subtle">
              {finalDraft.explanation}
            </p>
            {finalDraft.warnings.length > 0 && (
              <ul className="space-y-1 text-xs text-scout-subtle">
                {finalDraft.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        {error !== null && <p className="text-sm text-scout-danger">{error}</p>}
      </CardContent>
    </Card>
  );
}

export function selectBindingQuota(
  snapshots: ReportAiEditStatus["quota"],
): ReportAiQuotaSnapshot | null {
  if (snapshots.length === 0) return null;

  // 1. Any exhausted quota (0 remaining) is actively blocking
  const exhausted = snapshots.filter((s) => s.remaining === 0);
  if (exhausted.length > 0) {
    return exhausted.reduce((latest, s) =>
      new Date(s.resetsAt) > new Date(latest.resetsAt) ? s : latest,
    );
  }

  // 2. Any partially consumed quota
  const consumed = snapshots.filter((s) => s.remaining < s.limit);
  if (consumed.length > 0) {
    return consumed.reduce((tightest, s) => {
      if (s.remaining !== tightest.remaining) {
        return s.remaining < tightest.remaining ? s : tightest;
      }
      return s.scope === "user_guild" ? s : tightest;
    });
  }

  // 3. If unconsumed, prefer user's daily quota, then any user quota, else first
  const userDay = snapshots.find(
    (s) => s.scope === "user_guild" && s.window === "day",
  );
  if (userDay !== undefined) return userDay;

  const anyUser = snapshots.find((s) => s.scope === "user_guild");
  if (anyUser !== undefined) return anyUser;

  return snapshots[0] ?? null;
}

function quotaWindowLabel(
  window: ReportAiEditStatus["quota"][number]["window"],
): string {
  switch (window) {
    case "minute":
      return "minute";
    case "hour":
      return "hour";
    case "day":
      return "day";
    case "week":
      return "week";
  }
}

function bindingQuotaDescription(
  snapshot: ReportAiEditStatus["quota"][number],
): string {
  const scopePrefix =
    snapshot.scope === "user_guild"
      ? ""
      : snapshot.scope === "guild"
        ? "server "
        : "service ";
  return `${snapshot.remaining.toString()} of ${snapshot.limit.toString()} ${scopePrefix}edits left this ${quotaWindowLabel(snapshot.window)}`;
}

function QuotaSummary(props: { status: ReportAiEditStatus | undefined }) {
  if (props.status === undefined) {
    return <p className="text-xs text-scout-subtle">Loading credits…</p>;
  }
  if (props.status.exempt) {
    return null;
  }

  const binding = selectBindingQuota(props.status.quota);

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-scout-subtle">
        <span>
          {binding === null ? (
            "Credits available"
          ) : (
            <>
              <span className="font-medium text-scout-ink">
                {bindingQuotaDescription(binding)}
              </span>
              {binding.remaining < binding.limit ? (
                <> · resets {formatReset(binding.resetsAt)}</>
              ) : null}
            </>
          )}
        </span>
      </div>
      <details className="text-xs text-scout-subtle">
        <summary className="cursor-pointer text-[11px] text-scout-subtle hover:text-scout-ink">
          Details
        </summary>
        <div className="mt-1.5 grid gap-x-4 gap-y-1 rounded border border-border/60 bg-scout-hover/20 p-2 sm:grid-cols-2">
          {props.status.quota.map((snapshot) => (
            <p
              key={`${snapshot.scope}-${snapshot.window}`}
              className="text-[11px] text-scout-subtle"
            >
              <span className="font-medium text-scout-ink">
                {quotaScopeLabel(snapshot.scope)} {snapshot.window}:
              </span>{" "}
              {snapshot.remaining.toString()} of {snapshot.limit.toString()}{" "}
              remaining · resets {formatReset(snapshot.resetsAt)}
            </p>
          ))}
        </div>
      </details>
    </div>
  );
}

function quotaScopeLabel(
  scope: ReportAiEditStatus["quota"][number]["scope"],
): string {
  if (scope === "user_guild") {
    return "Your";
  }
  return scope === "guild" ? "Server" : "Service";
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
    return "text-xs text-[var(--scout-color-success)]";
  }
  if (tone === "error") {
    return "text-xs text-scout-danger";
  }
  return "text-xs text-scout-subtle";
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
