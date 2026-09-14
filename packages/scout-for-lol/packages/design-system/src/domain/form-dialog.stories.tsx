import type { Meta, StoryObj } from "@storybook/react-vite";
import { type ReactNode, useState } from "react";
import { Button } from "#src/components/button.tsx";
import {
  Field,
  FieldDescription,
  Input,
  Label,
} from "#src/components/forms/field.tsx";
import { FormDialogFrame } from "./form-dialog.tsx";

const meta = {
  title: "Domain/FormDialog",
  component: FormDialogFrame,
  tags: ["autodocs"],
} satisfies Meta<typeof FormDialogFrame>;

export default meta;

type Story = StoryObj<typeof meta>;

function noop(): void {
  // Story args need a handler; the story frame owns the real state.
}

/**
 * Stories that open the dialog keep every focusable control inside it: Radix
 * hides the rest of the document while a modal is open, so a button left behind
 * in the story root would be both focusable and `aria-hidden`.
 */
function DialogStage(props: {
  initialOpen: boolean;
  title: string;
  description?: string | undefined;
  confirmLabel: string;
  destructive?: boolean | undefined;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(props.initialOpen);
  const close = (): void => {
    setOpen(false);
  };
  return (
    <>
      {props.initialOpen ? (
        <p>Guild: Bearded Lyfe · Channel: #match-reports</p>
      ) : (
        <Button
          onClick={() => {
            setOpen(true);
          }}
        >
          {props.title}
        </Button>
      )}
      <FormDialogFrame
        open={open}
        onOpenChange={setOpen}
        title={props.title}
        description={props.description}
        footer={
          <>
            <Button variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button
              variant={props.destructive === true ? "destructive" : "default"}
              onClick={close}
            >
              {props.confirmLabel}
            </Button>
          </>
        }
      >
        {props.children}
      </FormDialogFrame>
    </>
  );
}

function SubscriptionFields() {
  return (
    <div className="scout-stack">
      <Field>
        <Label htmlFor="subscription-summoner">Riot ID</Label>
        <Input
          id="subscription-summoner"
          name="summoner"
          defaultValue="Bearded Lyfe #NA1"
        />
        <FieldDescription>
          Scout posts a report after every finished ranked match.
        </FieldDescription>
      </Field>
      <Field>
        <Label htmlFor="subscription-channel">Discord channel</Label>
        <Input
          id="subscription-channel"
          name="channel"
          defaultValue="#match-reports"
        />
      </Field>
    </div>
  );
}

export const CreateSubscription: Story = {
  args: {
    open: true,
    onOpenChange: noop,
    title: "New subscription",
    footer: null,
    children: null,
  },
  render: () => (
    <DialogStage
      initialOpen
      title="New subscription"
      description="Ranked Solo/Duo and Flex matches for this player are posted to the selected channel."
      confirmLabel="Create subscription"
    >
      <SubscriptionFields />
    </DialogStage>
  ),
};

export const WithoutDescription: Story = {
  args: {
    open: true,
    onOpenChange: noop,
    title: "Rename report",
    footer: null,
    children: null,
  },
  render: () => (
    <DialogStage initialOpen title="Rename report" confirmLabel="Save name">
      <Field>
        <Label htmlFor="report-name">Report name</Label>
        <Input
          id="report-name"
          name="report-name"
          defaultValue="Weekly Emerald climb"
        />
      </Field>
    </DialogStage>
  ),
};

export const DestructiveConfirmation: Story = {
  args: {
    open: true,
    onOpenChange: noop,
    title: "Remove subscription",
    footer: null,
    children: null,
  },
  render: () => (
    <DialogStage
      initialOpen
      destructive
      title="Remove subscription"
      description="Bearded Lyfe #NA1 stops posting to #match-reports immediately."
      confirmLabel="Remove subscription"
    >
      <p>
        Past reports stay in the report lake. Only future match posts are
        stopped.
      </p>
    </DialogStage>
  ),
};

export const TriggeredFromButton: Story = {
  args: {
    open: false,
    onOpenChange: noop,
    title: "Create competition",
    footer: null,
    children: null,
  },
  render: () => (
    <DialogStage
      initialOpen={false}
      title="Create competition"
      description="Members of this guild race to the highest LP gain over the cycle."
      confirmLabel="Start competition"
    >
      <Field>
        <Label htmlFor="competition-name">Competition name</Label>
        <Input
          id="competition-name"
          name="competition-name"
          defaultValue="Split 2 climb"
        />
      </Field>
    </DialogStage>
  ),
};
