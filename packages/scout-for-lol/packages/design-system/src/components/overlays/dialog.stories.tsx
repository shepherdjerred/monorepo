import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { Button } from "#src/components/button.tsx";
import { Field, Input, Label } from "#src/components/forms/field.tsx";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./dialog.tsx";

const meta = {
  title: "Components/Overlays/Dialog",
  component: Dialog,
  tags: ["autodocs"],
} satisfies Meta<typeof Dialog>;

export default meta;

type Story = StoryObj<typeof meta>;

function ControlledDialog() {
  const [open, setOpen] = useState(false);
  return (
    <div className="scout-stack">
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button variant="outline">Manage subscription</Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Weekly ranked digest</DialogTitle>
            <DialogDescription>
              Delivered to #ranked-reports every Monday at 09:00.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              onClick={() => {
                setOpen(false);
              }}
            >
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <p className="scout-muted">
        {open ? "Dialog is open." : "Dialog is closed."}
      </p>
    </div>
  );
}

export const CreateReport: Story = {
  args: {},
  render: () => (
    <Dialog>
      <DialogTrigger asChild>
        <Button>Create report</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create report</DialogTitle>
          <DialogDescription>
            Scout posts the finished report to the channel you pick.
          </DialogDescription>
        </DialogHeader>
        <Field>
          <Label htmlFor="dialog-create-report-name">Report name</Label>
          <Input
            id="dialog-create-report-name"
            name="title"
            defaultValue="Weekly ranked report"
          />
        </Field>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button type="button">Confirm</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ),
};

export const Destructive: Story = {
  args: {},
  render: () => (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="destructive">Delete subscription</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete this subscription?</DialogTitle>
          <DialogDescription>
            Scout stops posting ranked recaps for Faker#KR1 in this guild.
            Historic reports stay in the report lake.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Keep it</Button>
          </DialogClose>
          <DialogClose asChild>
            <Button variant="destructive">Delete subscription</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ),
};

export const DefaultOpen: Story = {
  args: {},
  render: () => (
    <Dialog defaultOpen>
      <DialogTrigger asChild>
        <Button variant="outline">Show dare receipt</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Dare settled</DialogTitle>
          <DialogDescription>
            Jinx lost the 10-kill dare and owes 250 Bryan Bucks to the pot.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button>Acknowledge</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ),
};

export const Controlled: Story = {
  args: {},
  render: () => <ControlledDialog />,
};
