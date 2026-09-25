import type { Meta, StoryObj } from "@storybook/react-vite";
import type { CheckedState } from "@radix-ui/react-checkbox";
import { useId, useState } from "react";
import { Checkbox } from "./checkbox.tsx";
import { Field, FieldDescription, FieldError, Label } from "./field.tsx";

const meta = {
  title: "Components/Forms/Checkbox",
  component: Checkbox,
  tags: ["autodocs"],
} satisfies Meta<typeof Checkbox>;

export default meta;

type Story = StoryObj<typeof meta>;

const queues = [
  { key: "solo", label: "Ranked Solo/Duo" },
  { key: "flex", label: "Ranked Flex 5v5" },
  { key: "aram", label: "ARAM" },
  { key: "arena", label: "Arena" },
] as const;

type QueueKey = (typeof queues)[number]["key"];

function summaryState(selectedCount: number, total: number): CheckedState {
  return selectedCount !== 0 && (selectedCount === total || "indeterminate");
}

function LabelledCheckbox({
  label,
  description = "",
  defaultChecked = false,
  disabled = false,
}: {
  readonly label: string;
  readonly description?: string;
  readonly defaultChecked?: boolean;
  readonly disabled?: boolean;
}) {
  const id = useId();
  const descriptionId = `${id}-description`;
  const hasDescription = description.length > 0;
  return (
    <Field>
      <Label className="scout-cluster" htmlFor={id}>
        <Checkbox
          id={id}
          defaultChecked={defaultChecked}
          disabled={disabled}
          aria-describedby={hasDescription ? descriptionId : undefined}
        />
        <span>{label}</span>
      </Label>
      {hasDescription ? (
        <FieldDescription id={descriptionId}>{description}</FieldDescription>
      ) : null}
    </Field>
  );
}

function QueueSelection() {
  const groupId = useId();
  const [selected, setSelected] = useState<readonly QueueKey[]>(["solo"]);

  function toggle(key: QueueKey, next: CheckedState): void {
    setSelected((current) =>
      next === true
        ? [...current.filter((item) => item !== key), key]
        : current.filter((item) => item !== key),
    );
  }

  return (
    <fieldset className="scout-form-section">
      <legend className="scout-form-section__legend">Tracked queues</legend>
      <div className="scout-stack">
        <Label className="scout-cluster" htmlFor={`${groupId}-all`}>
          <Checkbox
            id={`${groupId}-all`}
            checked={summaryState(selected.length, queues.length)}
            onCheckedChange={(next) => {
              setSelected(
                next === true ? queues.map((queue) => queue.key) : [],
              );
            }}
          />
          <span>All queues</span>
        </Label>
        {queues.map((queue) => (
          <Label
            key={queue.key}
            className="scout-cluster"
            htmlFor={`${groupId}-${queue.key}`}
          >
            <Checkbox
              id={`${groupId}-${queue.key}`}
              checked={selected.includes(queue.key)}
              onCheckedChange={(next) => {
                toggle(queue.key, next);
              }}
            />
            <span>{queue.label}</span>
          </Label>
        ))}
      </div>
    </fieldset>
  );
}

function InvalidConsent() {
  const id = useId();
  const errorId = `${id}-error`;
  return (
    <Field>
      <Label className="scout-cluster" htmlFor={id}>
        <Checkbox id={id} aria-invalid="true" aria-describedby={errorId} />
        <span>Post match recaps to #ranked-highlights</span>
      </Label>
      <FieldError id={errorId}>
        Scout needs channel permission before it can post recaps.
      </FieldError>
    </Field>
  );
}

export const Default: Story = {
  parameters: { controls: { disable: true } },
  render: () => <LabelledCheckbox label="Track ranked games" />,
};

export const Checked: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <LabelledCheckbox
      label="Include ARAM matches"
      defaultChecked
      description="ARAM results are summarised separately from ranked climb stats."
    />
  ),
};

export const Indeterminate: Story = {
  parameters: { controls: { disable: true } },
  render: () => <QueueSelection />,
};

export const Disabled: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="scout-stack">
      <LabelledCheckbox label="Track Teamfight Tactics" disabled />
      <LabelledCheckbox label="Track Wild Rift" disabled defaultChecked />
    </div>
  ),
};

export const Invalid: Story = {
  parameters: { controls: { disable: true } },
  render: () => <InvalidConsent />,
};
