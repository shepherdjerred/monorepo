import type { Meta, StoryObj } from "@storybook/react-vite";
import { useId, useState } from "react";
import { Combobox } from "./combobox.tsx";
import { Field, FieldDescription, FieldError, Label } from "./field.tsx";

// The combobox is a controlled generic component, so the args table needs inert
// placeholders. Every story renders its own stateful wrapper instead.
function noop(): void {
  return;
}

const meta = {
  title: "Components/Forms/Combobox",
  component: Combobox,
  tags: ["autodocs"],
  args: {
    value: "",
    items: [],
    isLoading: false,
    onValueChange: noop,
    getKey: () => "",
    renderItem: () => null,
    onSelect: noop,
  },
} satisfies Meta<typeof Combobox>;

export default meta;

type Story = StoryObj<typeof meta>;

type Champion = {
  readonly slug: string;
  readonly name: string;
  readonly role: string;
};

const champions: Champion[] = [
  { slug: "ahri", name: "Ahri", role: "Mid" },
  { slug: "jinx", name: "Jinx", role: "Bot" },
  { slug: "lee-sin", name: "Lee Sin", role: "Jungle" },
  { slug: "thresh", name: "Thresh", role: "Support" },
  { slug: "darius", name: "Darius", role: "Top" },
  { slug: "orianna", name: "Orianna", role: "Mid" },
];

function matchChampions(query: string): Champion[] {
  const needle = query.trim().toLowerCase();
  return champions.filter((champion) =>
    champion.name.toLowerCase().includes(needle),
  );
}

function ChampionCombobox(props: {
  readonly isLoading?: boolean | undefined;
  readonly disabled?: boolean | undefined;
  readonly invalid?: boolean | undefined;
  readonly openOnEmptyQuery?: boolean | undefined;
}) {
  const id = useId();
  const errorId = `${id}-error`;
  const descriptionId = `${id}-description`;
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<Champion | undefined>(undefined);
  const invalid = props.invalid === true;

  return (
    <div className="scout-stack" style={{ maxWidth: "22rem" }}>
      <Field>
        <Label htmlFor={id}>Champion focus</Label>
        <Combobox
          id={id}
          value={query}
          onValueChange={setQuery}
          items={props.isLoading === true ? [] : matchChampions(query)}
          isLoading={props.isLoading ?? false}
          getKey={(champion) => champion.slug}
          renderItem={(champion) => `${champion.name} — ${champion.role}`}
          onSelect={(champion) => {
            setPicked(champion);
            setQuery(champion.name);
          }}
          placeholder="Search champions"
          disabled={props.disabled}
          openOnEmptyQuery={props.openOnEmptyQuery}
          ariaInvalid={invalid}
          ariaDescribedBy={invalid ? errorId : descriptionId}
        />
        {invalid ? (
          <FieldError id={errorId}>
            Pick a champion from the suggestion list.
          </FieldError>
        ) : (
          <FieldDescription id={descriptionId}>
            Suggestions come from the ingested match history.
          </FieldDescription>
        )}
      </Field>
      <p className="scout-muted">
        {picked === undefined
          ? "No champion selected yet."
          : `Reports will highlight ${picked.name} (${picked.role}).`}
      </p>
    </div>
  );
}

export const Default: Story = {
  parameters: { controls: { disable: true } },
  render: () => <ChampionCombobox />,
};

export const OpenOnEmptyQuery: Story = {
  parameters: { controls: { disable: true } },
  render: () => <ChampionCombobox openOnEmptyQuery />,
};

export const Loading: Story = {
  parameters: { controls: { disable: true } },
  render: () => <ChampionCombobox isLoading openOnEmptyQuery />,
};

export const Invalid: Story = {
  parameters: { controls: { disable: true } },
  render: () => <ChampionCombobox invalid />,
};

export const Disabled: Story = {
  parameters: { controls: { disable: true } },
  render: () => <ChampionCombobox disabled />,
};
