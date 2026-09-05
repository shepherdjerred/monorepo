import { lazy, Suspense } from "react";
import { formOptions } from "@tanstack/react-form";
import type { z } from "zod";
import { Link } from "react-router";
import { ChevronDown } from "lucide-react";
import { DEFAULT_REPORT_CRON } from "@scout-for-lol/data";
import { Button } from "@scout-for-lol/design-system/components/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@scout-for-lol/design-system/components/collapsible";
import {
  Field,
  FieldDescription,
  FieldError,
  FormSection,
} from "@scout-for-lol/design-system/components/input";
import { ReportQueryDocs } from "#src/components/reports/report-query-docs.tsx";
import {
  ReportScheduleFields,
  scheduleField,
} from "#src/components/reports/report-schedule-fields.tsx";
import { ReportTimeControls } from "#src/components/reports/report-time-controls.tsx";
import {
  fieldErrorMessage,
  withScoutForm,
} from "#src/components/semantic-form.tsx";
import { ReportFormValueSchema } from "#src/lib/form-schemas.ts";

// Lazy so Monaco is split out of the main bundle and only loaded with this form.
const ReportQueryEditor = lazy(
  () => import("#src/components/reports/report-query-editor.tsx"),
);

export type ReportFormState = z.input<typeof ReportFormValueSchema>;

// A valid, ready-to-run starter query (identical to the "activity-leaders"
// preset, which `empty-report-query.test.ts` pins) so a fresh form submits
// without the user first writing ScoutQL.
export const STARTER_REPORT_QUERY = `SELECT COUNT(*) AS games, AVG(win::INT) AS win_rate
FROM match_participants
WHERE game_creation_at >= CURRENT_TIMESTAMP - INTERVAL 30 DAY
GROUP BY player
ORDER BY games DESC
LIMIT 10
RENDER leaderboard`;

export const EMPTY_REPORT_STATE: ReportFormState = {
  title: "",
  description: "",
  channelId: "",
  queryText: STARTER_REPORT_QUERY,
  cronExpression: DEFAULT_REPORT_CRON,
  scheduleTimezone: new Intl.DateTimeFormat().resolvedOptions().timeZone,
};

export const reportFormOptions = formOptions({
  defaultValues: EMPTY_REPORT_STATE,
});

export type ReportPayload = {
  title: string;
  description: string | null;
  channelId: string;
  queryText: string;
  cronExpression: string;
  scheduleTimezone: string;
};

/**
 * Parse + validate the string-backed form state into a payload ready for
 * `report.create` / `report.update`. Shared by the report route and the
 * onboarding wizard. The display lives in the query's trailing `RENDER`
 * clause, so there is no separate `outputFormat` field.
 */
export function buildReportPayload(
  state: ReportFormState,
): { ok: true; payload: ReportPayload } | { ok: false; message: string } {
  const parsed = ReportFormValueSchema.safeParse(state);
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "Check the report fields.",
    };
  }
  return {
    ok: true,
    payload: {
      title: parsed.data.title,
      description:
        parsed.data.description.length === 0 ? null : parsed.data.description,
      channelId: parsed.data.channelId,
      queryText: parsed.data.queryText,
      cronExpression: parsed.data.cronExpression,
      scheduleTimezone: parsed.data.scheduleTimezone,
    },
  };
}

type ReportFormFieldsProps = {
  channels: { id: string; name: string }[] | undefined;
  // When provided, renders a "Full reference" link next to the Query label
  // (the report route passes its guild-scoped help route; onboarding omits it).
  queryHelpHref?: string;
  // "collapsed" hides the ScoutQL editor behind an "Advanced" toggle (the
  // onboarding wizard, where the preset already fills the query). "expanded"
  // (default) shows it inline for the standalone report route.
  queryEditorDisclosure?: "expanded" | "collapsed";
  // The onboarding flow controls the disclosure so a failed submission can
  // reveal and focus a hidden invalid query editor.
  queryEditorOpen?: boolean;
  onQueryEditorOpenChange?: (open: boolean) => void;
};

const DEFAULT_REPORT_FORM_FIELDS_PROPS: ReportFormFieldsProps = {
  channels: undefined,
};

export const ReportFormFields = withScoutForm({
  ...reportFormOptions,
  props: DEFAULT_REPORT_FORM_FIELDS_PROPS,
  render: function ReportFormFieldsContent(props) {
    const { form, queryHelpHref } = props;
    const queryExpanded =
      (props.queryEditorDisclosure ?? "expanded") === "expanded";
    const onQueryEditorOpenChange = props.onQueryEditorOpenChange;
    const collapsibleState =
      onQueryEditorOpenChange === undefined ||
      props.queryEditorOpen === undefined
        ? { defaultOpen: queryExpanded }
        : {
            open: props.queryEditorOpen,
            onOpenChange: onQueryEditorOpenChange,
          };
    return (
      <div className="space-y-5">
        <FormSection
          legend="Report basics"
          description="Name the report and choose where Scout delivers it."
        >
          <form.AppField name="title">
            {(field) => (
              <field.TextField
                id="report-title"
                label="Title"
                autoComplete="off"
                maxLength={100}
                required
              />
            )}
          </form.AppField>
          <form.AppField name="description">
            {(field) => (
              <field.TextField
                id="report-description"
                label="Description (optional)"
                autoComplete="off"
                maxLength={500}
              />
            )}
          </form.AppField>
          <form.AppField name="channelId">
            {(field) => (
              <field.NativeSelectField
                id="report-channel"
                label="Delivery channel"
                placeholder="Pick a channel"
                options={(props.channels ?? []).map((channel) => ({
                  value: channel.id,
                  label: `#${channel.name}`,
                }))}
                required
              />
            )}
          </form.AppField>
        </FormSection>

        <FormSection
          legend="Analysis"
          description="Choose whether this report compares results over time."
        >
          <form.Subscribe selector={(state) => state.values.queryText}>
            {(queryText) => (
              <ReportTimeControls
                queryText={queryText}
                onChange={(nextQueryText) => {
                  form.setFieldValue("queryText", nextQueryText);
                }}
              />
            )}
          </form.Subscribe>
        </FormSection>

        <FormSection
          legend="ScoutQL query"
          description="Define the match data and visualization for this report."
        >
          <Collapsible {...collapsibleState} className="space-y-2">
            {!queryExpanded && (
              <CollapsibleTrigger asChild>
                <button
                  type="button"
                  className="group flex w-full items-start justify-between gap-2 rounded-md border border-border px-3 py-2 text-left hover:bg-scout-accent"
                >
                  <span className="space-y-0.5">
                    <span className="block text-sm font-medium">
                      Advanced: edit the ScoutQL query
                    </span>
                    <span className="block text-xs text-scout-subtle">
                      For users comfortable writing queries — the preset already
                      fills this in.
                    </span>
                  </span>
                  <ChevronDown
                    className="mt-0.5 h-4 w-4 shrink-0 text-scout-subtle transition-transform group-data-[state=open]:rotate-180"
                    aria-hidden="true"
                  />
                </button>
              </CollapsibleTrigger>
            )}
            <CollapsibleContent className="space-y-2">
              <div className="flex items-center justify-between">
                <p id="report-query-label" className="scout-label">
                  Query
                </p>
                {queryHelpHref !== undefined && (
                  <Button asChild variant="link" size="sm">
                    <Link to={queryHelpHref}>Full reference</Link>
                  </Button>
                )}
              </div>
              <form.AppField name="queryText">
                {(field) => {
                  const message = field.state.meta.isTouched
                    ? fieldErrorMessage(field.state.meta.errors)
                    : undefined;
                  return (
                    <Field>
                      <input
                        type="hidden"
                        name={field.name}
                        value={field.state.value}
                      />
                      <Suspense
                        fallback={
                          <div className="flex h-[180px] items-center justify-center rounded-md border border-border text-sm text-scout-subtle">
                            Loading editor…
                          </div>
                        }
                      >
                        <div
                          role="group"
                          aria-labelledby="report-query-label"
                          aria-describedby={
                            message === undefined
                              ? "report-query-description"
                              : "report-query-description report-query-error"
                          }
                          aria-invalid={
                            message === undefined ? undefined : true
                          }
                          tabIndex={message === undefined ? undefined : -1}
                        >
                          <ReportQueryEditor
                            value={field.state.value}
                            onChange={field.handleChange}
                          />
                        </div>
                      </Suspense>
                      <FieldDescription id="report-query-description">
                        End the query with a <code>RENDER &lt;kind&gt;</code>{" "}
                        clause to set the display, e.g.{" "}
                        <code>RENDER bar_chart with (y = win_rate)</code>. The
                        editor autocompletes the kinds and options.
                      </FieldDescription>
                      {message === undefined ? null : (
                        <FieldError id="report-query-error">
                          {message}
                        </FieldError>
                      )}
                    </Field>
                  );
                }}
              </form.AppField>
              <details className="rounded-md border border-border">
                <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-scout-subtle">
                  Query reference
                </summary>
                <div className="border-t border-border p-3">
                  <ReportQueryDocs />
                </div>
              </details>
            </CollapsibleContent>
          </Collapsible>
        </FormSection>

        <FormSection
          legend="Delivery schedule"
          description="Set when Scout publishes the report."
        >
          <form.AppField name="cronExpression">
            {(cronField) => (
              <form.AppField name="scheduleTimezone">
                {(timezoneField) => (
                  <ReportScheduleFields
                    cron={scheduleField(cronField)}
                    timezone={scheduleField(timezoneField)}
                  />
                )}
              </form.AppField>
            )}
          </form.AppField>
        </FormSection>
      </div>
    );
  },
});
