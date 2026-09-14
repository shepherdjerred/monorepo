import { useState, type ComponentProps } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import type {
  CompetitionGameVariant,
  CompetitionQueueType,
} from "@scout-for-lol/data";
import {
  handleFormSubmit,
  submitThenChangeValidation,
  useScoutForm,
} from "#src/components/semantic-form.tsx";
import { CompetitionFormValueSchema } from "#src/lib/form-schemas.ts";
import {
  CompetitionCriteriaFields,
  queueOptionsForVariant,
  type CriteriaState,
} from "./competition-criteria-fields.tsx";
import {
  CompetitionDatesFields,
  type DatesState,
} from "./competition-dates-fields.tsx";
import {
  CompetitionFormFields,
  EMPTY_STATE,
  competitionFormOptions,
  type FormState,
} from "./competition-form-fields.tsx";
import { CompetitionPresets } from "./competition-presets.tsx";
import { CompetitionQueueFields } from "./competition-queue-fields.tsx";

type CriteriaErrors = ComponentProps<
  typeof CompetitionCriteriaFields
>["errors"];

const NO_CRITERIA_ERRORS: CriteriaErrors = {
  gameVariant: undefined,
  criteriaType: undefined,
  queues: undefined,
  aggregation: undefined,
  championId: undefined,
  minGames: undefined,
};

const CHANNELS = [
  { id: "1084396924348997666", name: "league-reports" },
  { id: "1084396924348997667", name: "ranked-flex" },
];

const noop = () => {
  // Default args exist only so Storybook controls have a shape to show.
};

/** The criteria fields are fully controlled, so the story owns their state. */
function CriteriaHarness(props: {
  initial: CriteriaState;
  initialGameVariant: CompetitionGameVariant;
  errors?: Partial<CriteriaErrors>;
}) {
  const [value, setValue] = useState(props.initial);
  const [gameVariant, setGameVariant] = useState(props.initialGameVariant);
  return (
    <CompetitionCriteriaFields
      value={value}
      gameVariant={gameVariant}
      errors={{ ...NO_CRITERIA_ERRORS, ...props.errors }}
      onChange={setValue}
      onGameVariantChange={setGameVariant}
    />
  );
}

function DatesHarness(props: {
  initial: DatesState;
  initialTimezone: string;
  errors?: Partial<Record<"startDate" | "endDate" | "seasonId", string>>;
}) {
  const [value, setValue] = useState(props.initial);
  const [timezone, setTimezone] = useState(props.initialTimezone);
  return (
    <CompetitionDatesFields
      value={value}
      timezone={timezone}
      errors={{
        startDate: undefined,
        endDate: undefined,
        seasonId: undefined,
        ...props.errors,
      }}
      onChange={setValue}
      onTimezoneChange={setTimezone}
    />
  );
}

function QueuesHarness(props: {
  initial: CompetitionQueueType[];
  error: string | undefined;
}) {
  const [queues, setQueues] = useState(props.initial);
  return (
    <CompetitionQueueFields
      name="criteria.queues"
      value={queues}
      options={queueOptionsForVariant("MODERN")}
      error={props.error}
      onBlur={() => {
        // Blur only matters for touched-state validation in the real form.
      }}
      onChange={setQueues}
    />
  );
}

/**
 * `CompetitionFormFields` is a `withForm` composition, so it needs the same
 * form instance the real route builds — not props.
 */
function FormFieldsHarness(props: { locked: boolean; values: FormState }) {
  const form = useScoutForm({
    ...competitionFormOptions,
    defaultValues: props.values,
    validationLogic: submitThenChangeValidation,
    validators: { onDynamic: CompetitionFormValueSchema },
    onSubmit: () => {
      // Stories never create a competition.
    },
  });
  return (
    <form.AppForm>
      <form
        className="space-y-5"
        onSubmit={(event) => {
          handleFormSubmit(event, () => form.handleSubmit());
        }}
      >
        <CompetitionFormFields
          form={form}
          locked={props.locked}
          channels={CHANNELS}
        />
      </form>
    </form.AppForm>
  );
}

const meta = {
  title: "Competition/Fields",
  component: CompetitionCriteriaFields,
  tags: ["autodocs"],
} satisfies Meta<typeof CompetitionCriteriaFields>;

export default meta;

type Story = StoryObj<typeof meta>;

const CRITERIA_ARGS = {
  value: {
    criteriaType: "MOST_GAMES_PLAYED",
    queues: ["ALL"],
    aggregation: "MAX",
    championId: "",
    minGames: "10",
  },
  gameVariant: "MODERN",
  errors: NO_CRITERIA_ERRORS,
  onChange: noop,
  onGameVariantChange: noop,
} satisfies StoryObj<typeof meta>["args"];

export const CriteriaMostGames: Story = {
  args: CRITERIA_ARGS,
  render: () => (
    <CriteriaHarness
      initial={{
        criteriaType: "MOST_GAMES_PLAYED",
        queues: ["solo", "flex"],
        aggregation: "MAX",
        championId: "",
        minGames: "10",
      }}
      initialGameVariant="MODERN"
    />
  ),
};

export const CriteriaRankClimb: Story = {
  args: CRITERIA_ARGS,
  render: () => (
    <CriteriaHarness
      initial={{
        criteriaType: "MOST_RANK_CLIMB",
        queues: ["solo", "flex"],
        aggregation: "SUM",
        championId: "",
        minGames: "10",
      }}
      initialGameVariant="MODERN"
      errors={{ aggregation: "Pick how the two ladders combine." }}
    />
  ),
};

export const CriteriaChampionWins: Story = {
  args: CRITERIA_ARGS,
  render: () => (
    <CriteriaHarness
      initial={{
        criteriaType: "MOST_WINS_CHAMPION",
        queues: ["solo"],
        aggregation: "MAX",
        championId: "103",
        minGames: "10",
      }}
      initialGameVariant="MODERN"
    />
  ),
};

export const FixedDates: Story = {
  args: CRITERIA_ARGS,
  render: () => (
    <DatesHarness
      initial={{
        mode: "FIXED_DATES",
        startDate: "2026-09-14",
        endDate: "2026-09-13",
        seasonId: "",
      }}
      initialTimezone="America/Los_Angeles"
      errors={{ endDate: "End date must be after the start date." }}
    />
  ),
};

export const SeasonDates: Story = {
  args: CRITERIA_ARGS,
  render: () => (
    <DatesHarness
      initial={{
        mode: "SEASON",
        startDate: "",
        endDate: "",
        seasonId: "",
      }}
      initialTimezone="America/Los_Angeles"
      errors={{ seasonId: "Pick the season this competition runs in." }}
    />
  ),
};

export const QueueMultiselect: Story = {
  args: CRITERIA_ARGS,
  render: () => <QueuesHarness initial={["solo"]} error={undefined} />,
};

export const FullFormFields: Story = {
  args: CRITERIA_ARGS,
  render: () => (
    <FormFieldsHarness
      locked={false}
      values={{
        ...EMPTY_STATE,
        title: "Fall Ranked Solo/Duo climb",
        description:
          "Most Ranked Solo/Duo games played between the start and end of the split.",
        channelId: CHANNELS[0]?.id ?? "",
        analysisTimezone: "America/Los_Angeles",
        dates: {
          mode: "FIXED_DATES",
          startDate: "2026-09-14",
          endDate: "2026-10-26",
          seasonId: "",
        },
      }}
    />
  ),
};

export const LockedFormFields: Story = {
  args: CRITERIA_ARGS,
  render: () => (
    <FormFieldsHarness
      locked={true}
      values={{
        ...EMPTY_STATE,
        title: "Flex five-stack marathon",
        description: "Most Ranked Flex wins while the split is running.",
        channelId: CHANNELS[1]?.id ?? "",
        analysisTimezone: "America/Los_Angeles",
        criteria: {
          criteriaType: "MOST_WINS_PLAYER",
          queues: ["flex"],
          aggregation: "MAX",
          championId: "",
          minGames: "10",
        },
      }}
    />
  ),
};

export const Presets: Story = {
  args: CRITERIA_ARGS,
  render: () => (
    <CompetitionPresets
      onUsePreset={() => {
        // The real form prefills itself from the chosen example.
      }}
    />
  ),
};
