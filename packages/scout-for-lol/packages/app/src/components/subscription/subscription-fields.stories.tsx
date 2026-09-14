import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import type { SubscriptionFilterSpec } from "@scout-for-lol/data";
import {
  SubscriptionFields,
  subscriptionFormOptions,
} from "./subscription-fields.tsx";
import { SubscriptionFilterFields } from "./subscription-filter-fields.tsx";
import { FilterSummary } from "./subscription-filter-summary.tsx";
import {
  handleFormSubmit,
  useScoutForm,
} from "#src/components/semantic-form.tsx";
import { emptySubscriptionFormValue } from "#src/lib/form-schemas.ts";

/** Stories have no backend, so every handler is deliberately inert. */
function noop(): void {
  // Intentionally empty.
}

const GUILD_ID = "469558207670419456";

const CHANNELS = [
  { id: "1069813984308248657", name: "match-reports" },
  { id: "1069814032311730227", name: "ranked-only" },
  { id: "1069814077526343710", name: "aram-night" },
];

const RANKED: SubscriptionFilterSpec = {
  version: 1,
  filters: [{ type: "queue", queues: ["solo", "flex"] }],
};

const WIDE: SubscriptionFilterSpec = {
  version: 1,
  filters: [{ type: "queue", queues: ["solo", "flex", "aram", "clash"] }],
};

/**
 * `SubscriptionFields` is a `withScoutForm` component: it takes the form
 * instance rather than plain values, so the story owns a real TanStack form
 * and renders the fields inside it exactly as the add-subscription dialog does.
 */
function SubscriptionFieldsExample() {
  const form = useScoutForm({
    ...subscriptionFormOptions,
    defaultValues: emptySubscriptionFormValue(CHANNELS[0]?.id ?? ""),
  });
  return (
    <form.AppForm>
      <form
        className="max-w-xl space-y-4"
        onSubmit={(event) => {
          handleFormSubmit(event, () => form.handleSubmit());
        }}
      >
        <SubscriptionFields
          form={form}
          idPrefix="story-subscription"
          guildId={GUILD_ID}
          channels={CHANNELS}
        />
      </form>
    </form.AppForm>
  );
}

function FilterFieldsExample(props: {
  initial: SubscriptionFilterSpec | null;
}) {
  const [value, setValue] = useState<SubscriptionFilterSpec | null>(
    props.initial,
  );
  return (
    <div className="max-w-sm space-y-2">
      <label className="text-sm font-medium" htmlFor="story-queues">
        Notify for
      </label>
      <SubscriptionFilterFields
        id="story-queues"
        name="filters"
        value={value}
        onChange={setValue}
      />
    </div>
  );
}

const meta = {
  title: "Subscription/Fields",
  component: SubscriptionFilterFields,
  tags: ["autodocs"],
} satisfies Meta<typeof SubscriptionFilterFields>;

export default meta;

type Story = StoryObj<typeof meta>;

export const AllQueues: Story = {
  args: {
    id: "all-queues",
    name: "filters",
    value: null,
    onChange: noop,
  },
};

export const RankedOnly: Story = {
  args: {
    id: "ranked-only",
    name: "filters",
    value: RANKED,
    onChange: noop,
  },
};

export const Interactive: Story = {
  args: {
    id: "unused",
    name: "filters",
    value: null,
    onChange: noop,
  },
  render: () => <FilterFieldsExample initial={RANKED} />,
};

export const FullSubscriptionForm: Story = {
  args: {
    id: "unused",
    name: "filters",
    value: null,
    onChange: noop,
  },
  render: () => <SubscriptionFieldsExample />,
};

export const FilterSummaries: Story = {
  args: {
    id: "unused",
    name: "filters",
    value: null,
    onChange: noop,
  },
  render: () => (
    <dl className="space-y-3 text-sm">
      <div className="flex items-center gap-3">
        <dt className="w-40 text-scout-subtle">No filter</dt>
        <dd>
          <FilterSummary filters={null} isMuted={false} />
        </dd>
      </div>
      <div className="flex items-center gap-3">
        <dt className="w-40 text-scout-subtle">Ranked queues</dt>
        <dd>
          <FilterSummary filters={RANKED} isMuted={false} />
        </dd>
      </div>
      <div className="flex items-center gap-3">
        <dt className="w-40 text-scout-subtle">Four queues</dt>
        <dd>
          <FilterSummary filters={WIDE} isMuted={false} />
        </dd>
      </div>
      <div className="flex items-center gap-3">
        <dt className="w-40 text-scout-subtle">Muted</dt>
        <dd>
          <FilterSummary filters={RANKED} isMuted />
        </dd>
      </div>
    </dl>
  ),
};
