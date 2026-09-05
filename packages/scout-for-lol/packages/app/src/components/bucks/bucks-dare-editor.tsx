import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import {
  DareDeadlineSpecV2Schema,
  type DareDeadlineSpecV2,
} from "@scout-for-lol/data";
import { Button } from "@scout-for-lol/design-system/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@scout-for-lol/design-system/components/dialog";
import { Input } from "@scout-for-lol/design-system/components/input";
import { Textarea } from "@scout-for-lol/design-system/components/textarea";
import {
  DareEditorReview,
  type ValidatedDareDraft,
} from "#src/components/bucks/bucks-dare-editor-review.tsx";
import {
  focusFirstInvalid,
  handleFormSubmit,
  submitThenChangeValidation,
  useScoutForm,
} from "#src/components/semantic-form.tsx";
import { useTRPC } from "#src/lib/trpc.ts";

const ReadableSummarySchema = z.strictObject({
  plainLanguage: z.string().trim().min(1).max(4000),
});

type EditorDare = {
  id: number;
  currentRevision: number;
  originalText: string;
  deadlineSpec: DareDeadlineSpecV2;
  openingStake: number;
  canonicalScoutQl: string;
  plainLanguage: string;
  compilerVersion: string;
};

function ReadableSummaryField(props: {
  id: string;
  name: string;
  value: string;
  onValueChange: (value: string) => void;
}) {
  return (
    <label htmlFor={props.id} className="space-y-1 text-sm lg:col-span-2">
      <span className="font-medium">Readable summary</span>
      <Textarea
        id={props.id}
        name={props.name}
        required
        value={props.value}
        onChange={(event) => {
          props.onValueChange(event.target.value);
        }}
      />
      <span className="block text-xs text-scout-subtle">
        Explanatory only. The canonical SQL below remains binding.
      </span>
    </label>
  );
}

export function BucksDareEditor(props: { dare: EditorDare; guildId: string }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [originalText, setOriginalText] = useState(props.dare.originalText);
  const [queryText, setQueryText] = useState(props.dare.canonicalScoutQl);
  const [deadlineText, setDeadlineText] = useState(
    JSON.stringify(props.dare.deadlineSpec, null, 2),
  );
  const [stakeText, setStakeText] = useState(
    props.dare.openingStake.toString(),
  );
  const [historyDays, setHistoryDays] = useState("30");
  const [error, setError] = useState<string | null>(null);
  const [validated, setValidated] = useState<ValidatedDareDraft | null>(null);
  const [preview, setPreview] = useState<{
    achieved: boolean | null;
    eligibleGames: number;
    coverageComplete: boolean;
  } | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [validationPending, setValidationPending] = useState(false);
  const [previewPending, setPreviewPending] = useState(false);
  const inputVersion = useRef(0);
  const validationRequest = useRef(0);
  const previewRequest = useRef(0);
  const formElement = useRef<HTMLFormElement>(null);
  const revise = useMutation(trpc.bucks.dareReviseDraft.mutationOptions());
  const summaryForm = useScoutForm({
    defaultValues: { plainLanguage: props.dare.plainLanguage },
    validationLogic: submitThenChangeValidation,
    validators: { onDynamic: ReadableSummarySchema },
    onSubmit: async () => {
      await reviewOrSave();
    },
    onSubmitInvalid: () => {
      focusFirstInvalid(formElement.current);
    },
  });
  const fieldId = (name: string) =>
    `dare-${props.dare.id.toString()}-editor-${name}`;
  const sqlV3 = props.dare.compilerVersion === "dare-scoutql-3";

  function changed(): void {
    inputVersion.current += 1;
    previewRequest.current += 1;
    setPreviewPending(false);
    setValidated(null);
    setPreview(null);
    setReviewing(false);
    setError(null);
  }

  function editorInput() {
    let rawDeadline: unknown;
    try {
      rawDeadline = JSON.parse(deadlineText);
    } catch {
      setError("The deadline must be valid JSON.");
      return null;
    }
    const deadlineSpec = DareDeadlineSpecV2Schema.safeParse(rawDeadline);
    const openingStake = Number(stakeText);
    if (!deadlineSpec.success) {
      setError("The deadline does not match the Dare contract schema.");
      return null;
    }
    if (!Number.isSafeInteger(openingStake) || openingStake <= 0) {
      setError("Opening stake must be a positive whole number of BB.");
      return null;
    }
    return {
      dareId: props.dare.id,
      expectedRevision: props.dare.currentRevision,
      originalText,
      plainLanguage: summaryForm.state.values.plainLanguage,
      queryText,
      deadlineSpec: deadlineSpec.data,
      openingStake,
    };
  }

  async function validate(): Promise<ValidatedDareDraft | null> {
    const input = editorInput();
    if (input === null) return null;
    const version = inputVersion.current;
    const request = validationRequest.current + 1;
    validationRequest.current = request;
    setValidationPending(true);
    try {
      const result = await queryClient.query(
        trpc.bucks.dareValidateDraft.queryOptions({
          guildId: props.guildId,
          ...input,
        }),
      );
      if (
        version !== inputVersion.current ||
        request !== validationRequest.current
      ) {
        return null;
      }
      if (result.kind === "invalid") {
        setError(result.issues.join(" "));
        setValidated(null);
        return null;
      }
      setError(null);
      setQueryText(result.canonicalScoutQl);
      setValidated(result);
      return result;
    } catch (error_) {
      if (
        version === inputVersion.current &&
        request === validationRequest.current
      ) {
        setError(error_ instanceof Error ? error_.message : String(error_));
      }
      return null;
    } finally {
      if (request === validationRequest.current) {
        setValidationPending(false);
      }
    }
  }

  async function runPreview(): Promise<void> {
    const input = editorInput();
    if (input === null) return;
    const days = Number(historyDays);
    if (!Number.isSafeInteger(days) || days < 1 || days > 90) {
      setError("Historical preview must cover 1-90 days.");
      return;
    }
    const version = inputVersion.current;
    const request = previewRequest.current + 1;
    previewRequest.current = request;
    setPreviewPending(true);
    try {
      const result = await queryClient.query(
        trpc.bucks.darePreviewDraft.queryOptions({
          guildId: props.guildId,
          ...input,
          historyDays: days,
        }),
      );
      if (
        version !== inputVersion.current ||
        request !== previewRequest.current
      ) {
        return;
      }
      setPreview(result);
      setError(null);
    } catch (error_) {
      if (
        version === inputVersion.current &&
        request === previewRequest.current
      ) {
        setError(error_ instanceof Error ? error_.message : String(error_));
      }
    } finally {
      if (request === previewRequest.current) {
        setPreviewPending(false);
      }
    }
  }

  async function reviewOrSave(): Promise<void> {
    const input = editorInput();
    if (input === null) return;
    if (!reviewing) {
      const result = await validate();
      if (result !== null) setReviewing(true);
      return;
    }
    try {
      const outcome = await revise.mutateAsync({
        guildId: props.guildId,
        ...input,
      });
      if (outcome.kind !== "revised") {
        setError(
          `Draft was not revised (${outcome.kind.replaceAll("_", " ")}).`,
        );
        return;
      }
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: trpc.bucks.dareList.pathKey(),
        }),
        queryClient.invalidateQueries({
          queryKey: trpc.bucks.dareInspect.pathKey(),
        }),
      ]);
      setOpen(false);
    } catch (error_) {
      setError(error_ instanceof Error ? error_.message : String(error_));
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => {
          setOpen(true);
        }}
      >
        Advanced editor
      </Button>
      <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Dare #{props.dare.id.toString()}</DialogTitle>
          <DialogDescription>
            Edit the authoritative {sqlV3 ? "standard SQL" : "ScoutQL"}{" "}
            contract; Scout validates, formats, explains, and backtests it
            before replacing this private draft. No funded contract can enter
            this editor.
          </DialogDescription>
        </DialogHeader>
        <summaryForm.AppForm>
          <form
            ref={formElement}
            onSubmit={(event) => {
              handleFormSubmit(event, () => summaryForm.handleSubmit());
            }}
          >
            <fieldset disabled={revise.isPending} className="space-y-4">
              <div className="grid gap-4 lg:grid-cols-2">
                <label
                  htmlFor={fieldId("request")}
                  className="space-y-1 text-sm lg:col-span-2"
                >
                  <span className="font-medium">Original request</span>
                  <Textarea
                    id={fieldId("request")}
                    name="originalText"
                    required
                    value={originalText}
                    onChange={(event) => {
                      changed();
                      setOriginalText(event.target.value);
                    }}
                  />
                </label>
                {sqlV3 && (
                  <summaryForm.Field name="plainLanguage">
                    {(field) => (
                      <ReadableSummaryField
                        id={fieldId("summary")}
                        name={field.name}
                        value={field.state.value}
                        onValueChange={(value) => {
                          changed();
                          field.handleChange(value);
                        }}
                      />
                    )}
                  </summaryForm.Field>
                )}
                <label
                  htmlFor={fieldId("scoutql")}
                  className="space-y-1 text-sm"
                >
                  <span className="font-medium">
                    {sqlV3 ? "Binding SQL contract" : "ScoutQL contract"}
                  </span>
                  <Textarea
                    id={fieldId("scoutql")}
                    name="queryText"
                    required
                    className="min-h-80 font-mono text-xs"
                    spellCheck={false}
                    value={queryText}
                    onChange={(event) => {
                      changed();
                      setQueryText(event.target.value);
                    }}
                  />
                </label>
                <div className="space-y-4">
                  <label
                    htmlFor={fieldId("deadline")}
                    className="space-y-1 text-sm"
                  >
                    <span className="font-medium">Deadline specification</span>
                    <Textarea
                      id={fieldId("deadline")}
                      name="deadlineText"
                      required
                      className="font-mono text-xs"
                      spellCheck={false}
                      value={deadlineText}
                      onChange={(event) => {
                        changed();
                        setDeadlineText(event.target.value);
                      }}
                    />
                  </label>
                  <label
                    htmlFor={fieldId("stake")}
                    className="space-y-1 text-sm"
                  >
                    <span className="font-medium">Opening stake</span>
                    <Input
                      id={fieldId("stake")}
                      name="stakeText"
                      type="number"
                      inputMode="numeric"
                      min={1}
                      step={1}
                      required
                      value={stakeText}
                      onChange={(event) => {
                        changed();
                        setStakeText(event.target.value);
                      }}
                    />
                  </label>
                  <div className="flex items-end gap-2">
                    <label
                      htmlFor={fieldId("history-days")}
                      className="grow space-y-1 text-sm"
                    >
                      <span className="font-medium">Backtest days</span>
                      <Input
                        id={fieldId("history-days")}
                        name="historyDays"
                        type="number"
                        inputMode="numeric"
                        min={1}
                        max={90}
                        step={1}
                        required
                        value={historyDays}
                        onChange={(event) => {
                          previewRequest.current += 1;
                          setPreviewPending(false);
                          setPreview(null);
                          setError(null);
                          setHistoryDays(event.target.value);
                        }}
                      />
                    </label>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={previewPending}
                      onClick={() => void runPreview()}
                    >
                      {previewPending ? "Previewing…" : "Preview history"}
                    </Button>
                  </div>
                  {preview !== null && (
                    <p className="rounded-md border border-scout-border p-3 text-sm">
                      Historical result:{" "}
                      <strong>{String(preview.achieved)}</strong> ·{" "}
                      {preview.eligibleGames.toString()} eligible games ·
                      timeline{" "}
                      {preview.coverageComplete ? "complete" : "incomplete"}
                    </p>
                  )}
                </div>
              </div>
              <DareEditorReview
                validated={validated}
                reviewing={reviewing}
                sqlV3={sqlV3}
                currentRevision={props.dare.currentRevision}
                previous={props.dare}
                next={{ originalText, deadlineText, stakeText }}
              />
              {error !== null && (
                <p role="alert" className="text-sm text-scout-danger">
                  {error}
                </p>
              )}
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  disabled={validationPending}
                  onClick={() => void validate()}
                >
                  {validationPending ? "Validating…" : "Validate and format"}
                </Button>
                <Button type="submit" disabled={validationPending}>
                  {reviewing ? "Save revision" : "Review diff"}
                </Button>
              </div>
            </fieldset>
          </form>
        </summaryForm.AppForm>
      </DialogContent>
    </Dialog>
  );
}
