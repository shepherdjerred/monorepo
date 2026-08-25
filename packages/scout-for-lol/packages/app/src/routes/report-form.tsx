import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useSelector } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ReportIdSchema } from "@scout-for-lol/data";
import { useTRPC } from "#src/lib/trpc.ts";
import { analyticsMeta } from "#src/lib/analytics.ts";
import { Button } from "@scout-for-lol/design-system/components/button";
import { ReportQueryPreview } from "#src/components/report-query-preview.tsx";
import {
  buildReportPayload,
  reportFormOptions,
  ReportFormFields,
} from "#src/components/report-form-fields.tsx";
import { ReportCommonPresets } from "#src/components/report-common-presets.tsx";
import { ReportAiEditor } from "#src/components/report-ai-editor.tsx";
import { ReportDataExplorer } from "#src/components/report-data-explorer.tsx";
import {
  focusFirstInvalid,
  FormPendingStatus,
  handleFormReset,
  handleFormSubmit,
  ServerFormError,
  submitThenChangeValidation,
  useScoutForm,
} from "#src/components/semantic-form.tsx";
import { ReportFormValueSchema } from "#src/lib/form-schemas.ts";
import {
  UnsavedFormDialog,
  useUnsavedForm,
} from "#src/hooks/use-unsaved-form.tsx";
import { FormActions } from "@scout-for-lol/design-system/components/input";

function previewTitle(title: string): string {
  return title === "" ? "Preview" : title;
}

export function ReportForm() {
  const { guildId, reportId: idParam } = useParams();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const safeGuildId = guildId ?? "";

  const idResult =
    idParam === undefined ? null : ReportIdSchema.safeParse(Number(idParam));
  const isEdit = idResult !== null;
  const reportId =
    idResult?.success === true ? idResult.data : ReportIdSchema.parse(1);

  const [prefilled, setPrefilled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const formElement = useRef<HTMLFormElement>(null);
  const allowNavigation = useRef(false);

  const channelsQuery = useQuery(
    trpc.guild.listChannels.queryOptions(
      { guildId: safeGuildId },
      { enabled: guildId !== undefined },
    ),
  );
  const existingQuery = useQuery(
    trpc.report.get.queryOptions(
      { guildId: safeGuildId, reportId },
      { enabled: guildId !== undefined && idResult?.success === true },
    ),
  );

  const existing = existingQuery.data?.report;

  const createMutation = useMutation(
    trpc.report.create.mutationOptions({
      meta: analyticsMeta("report_created"),
      onSuccess: (created) => {
        allowNavigation.current = true;
        // The reports list carries a long staleTime, so invalidate it before
        // navigating — otherwise the newly created report is absent from the
        // list for up to STALE_TIME_SLOW_LIST.
        void queryClient.invalidateQueries({
          queryKey: trpc.report.list.pathKey(),
        });
        void navigate(`/g/${safeGuildId}/reports/${created.id.toString()}`);
      },
      onError: (err) => {
        setError(err.message);
      },
    }),
  );
  const updateMutation = useMutation(
    trpc.report.update.mutationOptions({
      meta: analyticsMeta("report_updated"),
      onSuccess: () => {
        allowNavigation.current = true;
        void queryClient.invalidateQueries({
          queryKey: trpc.report.list.pathKey(),
        });
        void navigate(`/g/${safeGuildId}/reports/${reportId.toString()}`);
      },
      onError: (err) => {
        setError(err.message);
      },
    }),
  );

  const form = useScoutForm({
    ...reportFormOptions,
    validationLogic: submitThenChangeValidation,
    validators: { onDynamic: ReportFormValueSchema },
    onSubmit: ({ value }) => {
      setError(null);
      allowNavigation.current = false;
      const built = buildReportPayload(value);
      if (!built.ok) {
        throw new Error(built.message);
      }
      if (isEdit) {
        updateMutation.mutate({
          guildId: safeGuildId,
          reportId,
          ...built.payload,
        });
        return;
      }
      createMutation.mutate({
        guildId: safeGuildId,
        isEnabled: true,
        ...built.payload,
      });
    },
    onSubmitInvalid: () => {
      focusFirstInvalid(formElement.current);
    },
  });
  const state = useSelector(form.store, (store) => store.values);
  const isDirty = useSelector(form.store, (store) => store.isDirty);
  const pending = createMutation.isPending || updateMutation.isPending;
  const blocker = useUnsavedForm(isDirty && !allowNavigation.current, pending);

  useEffect(() => {
    if (existing === undefined || prefilled) return;
    form.reset({
      title: existing.title,
      description: existing.description ?? "",
      channelId: existing.channelId,
      queryText: existing.queryText,
      cronExpression: existing.cronExpression,
      scheduleTimezone: existing.scheduleTimezone,
    });
    setPrefilled(true);
  }, [existing, form, prefilled]);

  if (guildId === undefined || (isEdit && !idResult.success)) {
    return <p className="text-sm text-scout-danger">Invalid report route.</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold tracking-tight">
          {isEdit ? "Edit report" : "New report"}
        </h2>
        <Button asChild variant="outline" size="sm">
          <Link to={`/g/${guildId}/reports`}>Back</Link>
        </Button>
      </div>

      {!isEdit && (
        <div className="grid gap-4 lg:grid-cols-2">
          <ReportCommonPresets
            onUsePreset={(preset) => {
              form.setFieldValue("title", preset.title);
              form.setFieldValue("description", preset.description);
              form.setFieldValue("queryText", preset.query);
            }}
          />
          <ReportAiEditor
            guildId={guildId}
            state={state}
            onApplyDraft={(draft) => {
              form.setFieldValue("title", draft.title);
              form.setFieldValue("description", draft.description);
              form.setFieldValue("queryText", draft.queryText);
            }}
          />
        </div>
      )}

      <form.AppForm>
        <form
          ref={formElement}
          onSubmit={(event) => {
            handleFormSubmit(event, () => form.handleSubmit());
          }}
          onReset={(event) => {
            handleFormReset(event, () => {
              form.reset();
            });
          }}
          aria-busy={pending}
          className="grid gap-6 lg:grid-cols-2"
        >
          <div className="space-y-4">
            <fieldset disabled={pending} className="m-0 border-0 p-0">
              <ReportFormFields
                form={form}
                channels={channelsQuery.data}
                queryHelpHref={`/g/${guildId}/reports/help`}
              />
            </fieldset>

            <ServerFormError error={error} />
            <FormPendingStatus pending={pending}>
              Saving report…
            </FormPendingStatus>

            <FormActions>
              <Button asChild variant="outline" type="button">
                <Link to={`/g/${guildId}/reports`}>Cancel</Link>
              </Button>
              <Button type="reset" variant="ghost" disabled={pending}>
                Reset
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? "Saving…" : isEdit ? "Save changes" : "Create"}
              </Button>
            </FormActions>
          </div>

          <ReportQueryPreview
            guildId={guildId}
            queryText={state.queryText}
            title={previewTitle(state.title)}
            sourceCompetitionId={existing?.sourceCompetitionId ?? null}
          />
        </form>
      </form.AppForm>
      <ReportDataExplorer
        guildId={guildId}
        onInsertIdentifier={(identifier) => {
          form.setFieldValue("queryText", (current) =>
            current.trim().length === 0
              ? identifier
              : `${current} ${identifier}`,
          );
        }}
      />
      <UnsavedFormDialog blocker={blocker} />
    </div>
  );
}
