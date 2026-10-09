import { useRouteGuildId } from "#src/lib/routes/route-params.ts";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@scout-for-lol/design-system/components/tabs";
import { Link, useNavigate, useParams } from "react-router";
import { useSelector } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ReportIdSchema } from "@scout-for-lol/data";
import { useTRPC } from "#src/lib/query/trpc.ts";
import { analyticsMeta } from "#src/lib/analytics.ts";
import { Button } from "@scout-for-lol/design-system/components/button";
import { channelAvailabilityForQuery } from "#src/components/channel-select-support.tsx";
import {
  editRecordNeedsLoad,
  EditRecordQueryState,
  EditRecordRefreshWarning,
  invalidEditRecordRoute,
  recordFormTitle,
  recordSubmitLabel,
} from "#src/components/edit-record-query-state.tsx";
import { ReportQueryPreview } from "#src/components/report/report-query-preview.tsx";
import {
  buildReportPayload,
  EMPTY_REPORT_STATE,
  reportFormOptions,
  ReportFormFields,
} from "#src/components/report/report-form-fields.tsx";
import { ReportCommonPresets } from "#src/components/report/report-common-presets.tsx";
import { ReportAiEditor } from "#src/components/report/report-ai-editor.tsx";
import { ReportDataExplorer } from "#src/components/report/report-data-explorer.tsx";
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
import { FormActions } from "@scout-for-lol/design-system/components/forms/field";

function previewTitle(title: string): string {
  return title === "" ? "Preview" : title;
}

function queryEditorDisclosure(isEdit: boolean, entryMethod: string) {
  return isEdit || entryMethod === "query" ? "expanded" : "collapsed";
}

export function ReportForm() {
  const [entryMethod, setEntryMethod] = useState("preset");
  const { reportId: idParam } = useParams();
  const guildId = useRouteGuildId();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const safeGuildId = guildId ?? "";

  const idResult =
    idParam === undefined ? null : ReportIdSchema.safeParse(Number(idParam));
  const isEdit = idResult !== null;
  const reportId =
    idResult?.success === true ? idResult.data : ReportIdSchema.parse(1);

  const [hydratedReportId, setHydratedReportId] = useState<number | null>(null);
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
  const formDefaults = useMemo(
    () =>
      existing === undefined
        ? EMPTY_REPORT_STATE
        : {
            title: existing.title,
            description: existing.description ?? "",
            channelId: existing.channelId,
            queryText: existing.queryText,
            cronExpression: existing.cronExpression,
            scheduleTimezone: existing.scheduleTimezone,
          },
    [existing],
  );

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
    defaultValues: formDefaults,
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
  const channelAvailability = channelAvailabilityForQuery(channelsQuery);
  const canSubmit =
    channelsQuery.data?.some((channel) => channel.id === state.channelId) ===
    true;
  const blocker = useUnsavedForm(isDirty && !allowNavigation.current, pending);

  useEffect(() => {
    if (existing?.id !== reportId) return;
    setHydratedReportId(reportId);
  }, [existing, reportId]);

  const invalidRoute = invalidEditRecordRoute(
    guildId,
    isEdit,
    idResult?.success === true,
  );
  const isEditWaitingForData = editRecordNeedsLoad(
    isEdit,
    existing?.id,
    reportId,
    hydratedReportId,
  );

  return (
    <form.AppForm>
      {invalidRoute || guildId === undefined ? (
        <p className="text-sm text-scout-danger">Invalid report route.</p>
      ) : isEditWaitingForData ? (
        <EditRecordQueryState
          recordName="report"
          listHref={`/g/${safeGuildId}/reports`}
          error={existingQuery.error}
          onRetry={() => {
            void existingQuery.refetch();
          }}
        />
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold tracking-tight">
              {recordFormTitle("report", isEdit)}
            </h2>
            <Button asChild variant="outline" size="sm">
              <Link to={`/g/${safeGuildId}/reports`}>Back</Link>
            </Button>
          </div>

          <EditRecordRefreshWarning
            recordName="report"
            error={existingQuery.error}
            hasSavedRecord={existing !== undefined}
            onRetry={() => {
              void existingQuery.refetch();
            }}
          />

          {idParam === undefined && (
            <Tabs value={entryMethod} onValueChange={setEntryMethod}>
              <TabsList
                aria-label="Start a report"
                className="flex h-auto flex-wrap justify-start"
              >
                <TabsTrigger value="preset">Use a preset</TabsTrigger>
                <TabsTrigger value="describe">Describe a report</TabsTrigger>
                <TabsTrigger value="query">Write a query</TabsTrigger>
              </TabsList>
              <TabsContent
                value="preset"
                className="max-h-80 overflow-y-auto rounded-lg focus-visible:outline-2"
              >
                <ReportCommonPresets
                  onUsePreset={(preset) => {
                    form.setFieldValue("title", preset.title);
                    form.setFieldValue("description", preset.description);
                    form.setFieldValue("queryText", preset.query);
                    setEntryMethod("query");
                    requestAnimationFrame(() =>
                      formElement.current?.querySelector("input")?.focus(),
                    );
                  }}
                />
              </TabsContent>
              <TabsContent value="describe">
                <ReportAiEditor
                  guildId={guildId}
                  state={state}
                  onApplyDraft={(draft) => {
                    form.setFieldValue("title", draft.title);
                    form.setFieldValue("description", draft.description);
                    form.setFieldValue("queryText", draft.queryText);
                    setEntryMethod("query");
                    requestAnimationFrame(() =>
                      formElement.current?.querySelector("input")?.focus(),
                    );
                  }}
                />
              </TabsContent>
              <TabsContent value="query" />
            </Tabs>
          )}

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
                  channelAvailability={channelAvailability}
                  onRetryChannels={() => {
                    void channelsQuery.refetch();
                  }}
                  queryHelpHref={`/g/${safeGuildId}/reports/help`}
                  queryEditorDisclosure={queryEditorDisclosure(
                    isEdit,
                    entryMethod,
                  )}
                  queryEditorOpen={
                    queryEditorDisclosure(isEdit, entryMethod) === "expanded"
                  }
                  onQueryEditorOpenChange={(open) => {
                    if (open) setEntryMethod("query");
                  }}
                />
              </fieldset>

              <ServerFormError error={error} />
              <FormPendingStatus pending={pending}>
                Saving report…
              </FormPendingStatus>

              <FormActions>
                <Button asChild variant="outline" type="button">
                  <Link to={`/g/${safeGuildId}/reports`}>Cancel</Link>
                </Button>
                <Button type="reset" variant="ghost" disabled={pending}>
                  Reset
                </Button>
                <Button type="submit" disabled={pending || !canSubmit}>
                  {recordSubmitLabel(pending, isEdit)}
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
          <details>
            <summary className="cursor-pointer text-sm font-medium">
              Query reference
            </summary>
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
          </details>
          <UnsavedFormDialog blocker={blocker} />
        </div>
      )}
    </form.AppForm>
  );
}
