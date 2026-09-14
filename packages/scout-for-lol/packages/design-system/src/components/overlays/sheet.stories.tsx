import type { Meta, StoryObj } from "@storybook/react-vite";
import { Menu } from "lucide-react";
import { useState } from "react";
import { Button, IconButton } from "#src/components/button.tsx";
import { Field, Input, Label } from "#src/components/forms/field.tsx";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "./sheet.tsx";

const meta = {
  title: "Components/Overlays/Sheet",
  component: Sheet,
  tags: ["autodocs"],
} satisfies Meta<typeof Sheet>;

export default meta;

type Story = StoryObj<typeof meta>;

const navigationLinks = [
  { href: "#overview", label: "Guild overview" },
  { href: "#matches", label: "Recent matches" },
  { href: "#subscriptions", label: "Subscriptions" },
  { href: "#dares", label: "Open dares" },
] as const;

function ControlledSheet() {
  const [open, setOpen] = useState(false);
  return (
    <div className="scout-stack">
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button variant="outline">Edit subscription</Button>
        </SheetTrigger>
        <SheetContent>
          <div className="scout-stack">
            <SheetTitle className="scout-dialog__title">
              Edit subscription
            </SheetTitle>
            <Field>
              <Label htmlFor="sheet-subscription-channel">Channel</Label>
              <Input
                id="sheet-subscription-channel"
                name="channel"
                defaultValue="#ranked-reports"
              />
            </Field>
            <Button
              onClick={() => {
                setOpen(false);
              }}
            >
              Save changes
            </Button>
          </div>
        </SheetContent>
      </Sheet>
      <p className="scout-muted">
        {open ? "Sheet is open." : "Sheet is closed."}
      </p>
    </div>
  );
}

export const Default: Story = {
  args: {},
  render: () => (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="outline">Open navigation</Button>
      </SheetTrigger>
      <SheetContent>
        <div className="scout-stack">
          <SheetTitle className="scout-dialog__title">Scout</SheetTitle>
          <ul className="scout-stack">
            {navigationLinks.map((link) => (
              <li key={link.href}>
                <a href={link.href}>{link.label}</a>
              </li>
            ))}
          </ul>
        </div>
      </SheetContent>
    </Sheet>
  ),
};

export const IconTrigger: Story = {
  args: {},
  render: () => (
    <Sheet>
      <SheetTrigger asChild>
        <IconButton label="Open menu" variant="ghost">
          <Menu />
        </IconButton>
      </SheetTrigger>
      <SheetContent>
        <div className="scout-stack">
          <SheetTitle className="scout-dialog__title">Match filters</SheetTitle>
          <p className="scout-muted">
            Narrow the report lake query before re-rendering.
          </p>
          <SheetClose asChild>
            <Button variant="outline">Dismiss</Button>
          </SheetClose>
        </div>
      </SheetContent>
    </Sheet>
  ),
};

export const DefaultOpen: Story = {
  args: {},
  render: () => (
    <Sheet defaultOpen>
      <SheetTrigger asChild>
        <Button variant="outline">Show ingest log</Button>
      </SheetTrigger>
      <SheetContent>
        <div className="scout-stack">
          <SheetTitle className="scout-dialog__title">Ingest log</SheetTitle>
          <ul className="scout-stack">
            <li>4291847302 — projected with receipt</li>
            <li>4291846118 — projected with receipt</li>
            <li>4291844907 — awaiting prematch JSON</li>
          </ul>
          <SheetClose asChild>
            <Button>Close log</Button>
          </SheetClose>
        </div>
      </SheetContent>
    </Sheet>
  ),
};

export const Controlled: Story = {
  args: {},
  render: () => <ControlledSheet />,
};
