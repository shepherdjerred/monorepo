import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { ReportFormValueSchema } from "#src/lib/form-schemas.ts";
import {
  submitThenChangeValidation,
  useScoutForm,
} from "#src/components/semantic-form.tsx";
import { ReportTimeControls } from "./report-time-controls.tsx";
import { ReportScheduleFields } from "./report-schedule-fields.tsx";
import { ReportCommonPresets } from "./report-common-presets.tsx";
import {
  ReportFormFields,
  reportFormOptions,
  STARTER_REPORT_QUERY,
} from "./report-form-fields.tsx";

function noop(): void {
  // Story callbacks are deliberately inert.
}

const CHANNELS = [
  { id: "1102938475610293847", name: "match-reports" },
  { id: "1102938475610293848", name: "ranked-grind" },
];

const BOUNDED_QUERY = STARTER_REPORT_QUERY;

const BROKEN_QUERY = `SELECT COUNT(*) AS games
FROM match_participants
WHERE game_creation_at >= CURRENT_TIMESTAMP - INTERVAL 30 DAY
GROUP BY player
RENDER wombat`;

/**
 * `ReportFormFields` is a `withScoutForm` view, so a story has to own the form
 * instance the report route would normally provide.
 *
 * The ScoutQL editor stays collapsed on purpose: opening it mounts the lazy
 * Monaco bundle, which Storybook has no worker configuration for.
 */
function ReportFormFieldsHarness() {
  const [queryEditorOpen, setQueryEditorOpen] = useState(false);
  const form = useScoutForm({
    ...reportFormOptions,
    defaultValues: {
      title: "Weekly activity leaders",
      description: "Who played the most Summoner's Rift this week.",
      channelId: "1102938475610293847",
      queryText: BOUNDED_QUERY,
      cronExpression: "0 18 * * 1",
      scheduleTimezone: "America/Chicago",
    },
    validationLogic: submitThenChangeValidation,
    validators: { onDynamic: ReportFormValueSchema },
    onSubmit: noop,
  });
  return (
    <form.AppForm>
      <ReportFormFields
        form={form}
        channels={CHANNELS}
        queryEditorDisclosure="collapsed"
        queryEditorOpen={queryEditorOpen}
        onQueryEditorOpenChange={setQueryEditorOpen}
      />
    </form.AppForm>
  );
}

function TimeControlsHarness(props: { initialQuery: string }) {
  const [queryText, setQueryText] = useState(props.initialQuery);
  return (
    <div className="space-y-3">
      <ReportTimeControls queryText={queryText} onChange={setQueryText} />
      <pre className="overflow-x-auto whitespace-pre-wrap rounded-md border border-scout-border bg-scout-hover/50 p-3 font-mono text-xs leading-5">
        {queryText}
      </pre>
    </div>
  );
}

function ScheduleFieldsHarness(props: { initialCron: string }) {
  const [cron, setCron] = useState(props.initialCron);
  const [timezone, setTimezone] = useState("America/Chicago");
  return (
    <ReportScheduleFields
      cron={{
        name: "cronExpression",
        value: cron,
        error: undefined,
        onChange: setCron,
        onBlur: noop,
      }}
      timezone={{
        name: "scheduleTimezone",
        value: timezone,
        error: undefined,
        onChange: setTimezone,
        onBlur: noop,
      }}
    />
  );
}

function PresetsHarness() {
  const [chosen, setChosen] = useState<string | null>(null);
  return (
    <div className="space-y-3">
      <ReportCommonPresets
        onUsePreset={(preset) => {
          setChosen(preset.title);
        }}
      />
      <p className="text-sm text-scout-subtle" role="status">
        {chosen === null ? "No preset applied yet." : `Applied: ${chosen}`}
      </p>
    </div>
  );
}

const meta = {
  title: "Report/Fields",
  component: ReportTimeControls,
  tags: ["autodocs"],
} satisfies Meta<typeof ReportTimeControls>;

export default meta;

type Story = StoryObj<typeof meta>;

const unusedArgs = {
  queryText: BOUNDED_QUERY,
  onChange: noop,
};

export const TimeControls: Story = {
  args: unusedArgs,
  render: () => <TimeControlsHarness initialQuery={BOUNDED_QUERY} />,
};

export const TimeControlsUnavailable: Story = {
  args: unusedArgs,
  render: () => <TimeControlsHarness initialQuery={BROKEN_QUERY} />,
};

export const ScheduleFieldsPreset: Story = {
  args: unusedArgs,
  render: () => <ScheduleFieldsHarness initialCron="0 18 * * 1" />,
};

export const ScheduleFieldsCustomCron: Story = {
  args: unusedArgs,
  render: () => <ScheduleFieldsHarness initialCron="45 7 * * 3" />,
};

export const CommonPresets: Story = {
  args: unusedArgs,
  render: () => <PresetsHarness />,
};

export const FormFields: Story = {
  args: unusedArgs,
  render: () => <ReportFormFieldsHarness />,
};
