import type { Meta, StoryObj } from "@storybook/react-vite";
import { useId, useState } from "react";
import { Switch } from "./switch.tsx";
import { Field, FieldDescription, Label } from "./field.tsx";

const meta = {
  title: "Components/Forms/Switch",
  component: Switch,
  tags: ["autodocs"],
} satisfies Meta<typeof Switch>;

export default meta;

type Story = StoryObj<typeof meta>;

function PublishSwitch() {
  return (
    <Label className="scout-cluster" htmlFor="publish-automatically">
      <Switch id="publish-automatically" aria-label="Publish automatically" />
      <span>Publish automatically</span>
    </Label>
  );
}

function DescribedSwitch({
  label,
  description,
  defaultChecked = false,
  disabled = false,
}: {
  readonly label: string;
  readonly description: string;
  readonly defaultChecked?: boolean;
  readonly disabled?: boolean;
}) {
  const id = useId();
  const descriptionId = `${id}-description`;
  return (
    <Field>
      <Label className="scout-cluster" htmlFor={id}>
        <Switch
          id={id}
          aria-label={label}
          aria-describedby={descriptionId}
          defaultChecked={defaultChecked}
          disabled={disabled}
        />
        <span>{label}</span>
      </Label>
      <FieldDescription id={descriptionId}>{description}</FieldDescription>
    </Field>
  );
}

function ControlledSwitch() {
  const id = useId();
  const [checked, setChecked] = useState(false);
  return (
    <div className="scout-stack">
      <Label className="scout-cluster" htmlFor={id}>
        <Switch
          id={id}
          aria-label="Mention @everyone on pentakills"
          checked={checked}
          onCheckedChange={setChecked}
        />
        <span>Mention @everyone on pentakills</span>
      </Label>
      <p className="scout-muted">
        {checked
          ? "Scout will ping the whole guild for a pentakill."
          : "Pentakills are posted quietly."}
      </p>
    </div>
  );
}

export const Default: Story = {
  args: {},
  render: () => <PublishSwitch />,
};

export const On: Story = {
  args: {},
  render: () => (
    <DescribedSwitch
      label="Weekly ranked digest"
      description="Posted to the subscription channel every Monday at 09:00."
      defaultChecked
    />
  ),
};

export const WithDescription: Story = {
  args: {},
  render: () => (
    <DescribedSwitch
      label="Include Bryan Bucks payouts"
      description="Dare settlements are appended to each match recap."
    />
  ),
};

export const Disabled: Story = {
  args: {},
  render: () => (
    <div className="scout-stack">
      <DescribedSwitch
        label="Live match alerts"
        description="Requires a Riot production key on this guild."
        disabled
      />
      <DescribedSwitch
        label="Spectator replays"
        description="Not available while the region is in maintenance."
        disabled
        defaultChecked
      />
    </div>
  ),
};

export const Controlled: Story = {
  args: {},
  render: () => <ControlledSwitch />,
};
