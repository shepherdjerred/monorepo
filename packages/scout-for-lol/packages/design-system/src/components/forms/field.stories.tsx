import type { Meta, StoryObj } from "@storybook/react-vite";
import { useId, useState } from "react";
import { Button } from "#src/components/button.tsx";
import {
  Field,
  FieldDescription,
  FieldError,
  FormActions,
  FormSection,
  Input,
  Label,
  Textarea,
} from "./field.tsx";

const meta = {
  title: "Components/Forms/Field",
  component: Field,
  tags: ["autodocs"],
} satisfies Meta<typeof Field>;

export default meta;

type Story = StoryObj<typeof meta>;

function DescribedField() {
  const id = useId();
  const descriptionId = `${id}-description`;
  return (
    <Field>
      <Label htmlFor={id}>Report name</Label>
      <Input
        id={id}
        name="title"
        defaultValue="Weekly ranked report"
        maxLength={100}
        aria-describedby={descriptionId}
      />
      <FieldDescription id={descriptionId}>
        Shown as the embed title in the Discord channel.
      </FieldDescription>
    </Field>
  );
}

function ErroredField() {
  const id = useId();
  const errorId = `${id}-error`;
  return (
    <Field>
      <Label htmlFor={id}>Riot ID</Label>
      <Input
        id={id}
        name="riotId"
        defaultValue="Faker"
        aria-invalid="true"
        aria-describedby={errorId}
      />
      <FieldError id={errorId}>
        A Riot ID needs a tagline, for example Faker#KR1.
      </FieldError>
    </Field>
  );
}

function TextareaField() {
  const id = useId();
  const [value, setValue] = useState(
    "Congratulations to the flex squad for a 7-game win streak.",
  );
  return (
    <Field>
      <Label htmlFor={id}>Recap note</Label>
      <Textarea
        id={id}
        name="note"
        rows={4}
        value={value}
        onChange={(event) => {
          setValue(event.target.value);
        }}
      />
      <FieldDescription>{`${String(value.length)} / 280 characters`}</FieldDescription>
    </Field>
  );
}

export const Default: Story = {
  args: {},
  render: () => (
    <div className="scout-stack">
      <DescribedField />
    </div>
  ),
};

export const WithError: Story = {
  args: {},
  render: () => (
    <div className="scout-stack">
      <ErroredField />
    </div>
  ),
};

export const MultilineInput: Story = {
  args: {},
  render: () => (
    <div className="scout-stack">
      <TextareaField />
    </div>
  ),
};

export const Section: Story = {
  args: {},
  render: () => (
    <FormSection
      legend="Subscription"
      description="Where Scout delivers this guild's ranked reports."
    >
      <Field>
        <Label htmlFor="field-section-channel">Discord channel</Label>
        <Input
          id="field-section-channel"
          name="channel"
          defaultValue="#ranked-reports"
        />
      </Field>
      <Field>
        <Label htmlFor="field-section-summoner">Tracked summoner</Label>
        <Input
          id="field-section-summoner"
          name="summoner"
          placeholder="Faker#KR1"
        />
      </Field>
      <FormActions>
        <Button variant="outline" type="button">
          Cancel
        </Button>
        <Button type="button">Save subscription</Button>
      </FormActions>
    </FormSection>
  ),
};

export const SemanticFormStates: Story = {
  args: {},
  render: () => (
    <form
      aria-label="Semantic form states"
      onSubmit={(event) => {
        event.preventDefault();
      }}
    >
      <FormSection
        legend="Report basics"
        description="Controls keep their native browser behavior."
      >
        <Field>
          <Label htmlFor="form-pristine">Pristine</Label>
          <Input
            id="form-pristine"
            name="title"
            placeholder="Weekly ranked report"
            maxLength={100}
            required
          />
        </Field>
        <Field>
          <Label htmlFor="form-native-invalid">Native-invalid example</Label>
          <Input
            id="form-native-invalid"
            name="email"
            type="email"
            defaultValue="not-an-email"
            aria-describedby="form-native-invalid-description"
            required
          />
          <FieldDescription id="form-native-invalid-description">
            The browser owns type and required validation.
          </FieldDescription>
        </Field>
        <Field>
          <Label htmlFor="form-zod-invalid">Zod-invalid example</Label>
          <Input
            id="form-zod-invalid"
            name="alias"
            defaultValue="?"
            aria-invalid="true"
            aria-describedby="form-zod-invalid-error"
          />
          <FieldError id="form-zod-invalid-error">
            Choose a known player alias.
          </FieldError>
        </Field>
        <fieldset disabled style={{ margin: 0, padding: 0, border: 0 }}>
          <Field>
            <Label htmlFor="form-disabled">Disabled group</Label>
            <Input
              id="form-disabled"
              name="disabled-value"
              defaultValue="Unavailable while saving"
            />
          </Field>
        </fieldset>
      </FormSection>
      <p role="alert" className="scout-field__error">
        The server could not save this example.
      </p>
      <FormActions>
        <Button type="reset" variant="outline">
          Reset
        </Button>
        <Button type="submit">Create report</Button>
      </FormActions>
    </form>
  ),
};
