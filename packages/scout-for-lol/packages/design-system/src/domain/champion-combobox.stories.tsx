import { browserChampions } from "@scout-for-lol/data/browser-assets";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import {
  Field,
  FieldDescription,
  Label,
} from "#src/components/forms/field.tsx";
import { ChampionCombobox, type ChampionOption } from "./champion-combobox.tsx";

const meta = {
  title: "Domain/ChampionCombobox",
  component: ChampionCombobox,
  tags: ["autodocs"],
} satisfies Meta<typeof ChampionCombobox>;

export default meta;

type Story = StoryObj<typeof meta>;

function noop(): void {
  // Story args need a handler; the story frame owns the real state.
}

function findChampion(name: string): ChampionOption {
  const champion = browserChampions.find((entry) => entry.name === name);
  if (champion === undefined) {
    throw new Error(`Unknown champion ${name}`);
  }
  return champion;
}

const midlanePool = ["Ahri", "Azir", "Orianna", "Syndra", "Viktor"].map(
  (name) => findChampion(name),
);

const FIELD_ID = "scout-champion-combobox";
const HINT_ID = "scout-champion-combobox-hint";

function ChampionField(props: {
  label: string;
  initial?: ChampionOption | undefined;
  items?: ChampionOption[] | undefined;
  disabled?: boolean | undefined;
  required?: boolean | undefined;
  invalid?: boolean | undefined;
  hint?: string | undefined;
  placeholder?: string | undefined;
}) {
  const [champion, setChampion] = useState(props.initial);
  return (
    <Field>
      <Label htmlFor={FIELD_ID}>{props.label}</Label>
      <ChampionCombobox
        id={FIELD_ID}
        name="champion"
        value={champion}
        onChange={setChampion}
        items={props.items}
        disabled={props.disabled}
        required={props.required}
        ariaInvalid={props.invalid}
        ariaDescribedBy={props.hint === undefined ? undefined : HINT_ID}
        placeholder={props.placeholder}
      />
      {props.hint === undefined ? null : (
        <FieldDescription id={HINT_ID}>{props.hint}</FieldDescription>
      )}
    </Field>
  );
}

export const Empty: Story = {
  args: { value: undefined, onChange: noop },
  parameters: { controls: { disable: true } },
  render: () => <ChampionField label="Champion" />,
};

export const Preselected: Story = {
  args: { value: undefined, onChange: noop },
  parameters: { controls: { disable: true } },
  render: () => (
    <ChampionField label="Champion" initial={findChampion("Ahri")} />
  ),
};

export const RestrictedPool: Story = {
  args: { value: undefined, onChange: noop },
  parameters: { controls: { disable: true } },
  render: () => (
    <ChampionField
      label="Mid lane pool"
      items={midlanePool}
      initial={findChampion("Orianna")}
      hint="Only the five champions this roster banned in scrims are selectable."
      placeholder="Search the mid lane pool"
    />
  ),
};

export const Required: Story = {
  args: { value: undefined, onChange: noop },
  parameters: { controls: { disable: true } },
  render: () => (
    <ChampionField
      label="Champion for this dare"
      required
      hint="Ranked Solo/Duo games on this champion settle the dare."
    />
  ),
};

export const Invalid: Story = {
  args: { value: undefined, onChange: noop },
  parameters: { controls: { disable: true } },
  render: () => (
    <ChampionField
      label="Champion"
      invalid
      hint="Pick a champion from the list — free text is not accepted."
    />
  ),
};

export const Disabled: Story = {
  args: { value: undefined, onChange: noop },
  parameters: { controls: { disable: true } },
  render: () => (
    <ChampionField
      label="Champion"
      disabled
      initial={findChampion("Thresh")}
      hint="Locked while the subscription is paused."
    />
  ),
};
