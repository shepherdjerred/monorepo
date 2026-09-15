import type { Meta, StoryObj } from "@storybook/react-vite";
import { Filter } from "lucide-react";
import { useState } from "react";
import { Button, IconButton } from "#src/components/button.tsx";
import { Checkbox } from "#src/components/forms/checkbox.tsx";
import { Field, Input, Label } from "#src/components/forms/field.tsx";
import { Popover, PopoverContent, PopoverTrigger } from "./popover.tsx";

const meta = {
  title: "Components/Overlays/Popover",
  component: Popover,
  tags: ["autodocs"],
} satisfies Meta<typeof Popover>;

export default meta;

type Story = StoryObj<typeof meta>;

function ControlledPopover() {
  const [open, setOpen] = useState(false);
  return (
    <div className="scout-stack">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline">Bryan Bucks balance</Button>
        </PopoverTrigger>
        <PopoverContent>
          <div className="scout-stack">
            <strong>1,250 Bryan Bucks</strong>
            <p className="scout-muted">
              320 staked across two open dares this week.
            </p>
            <Button
              size="sm"
              onClick={() => {
                setOpen(false);
              }}
            >
              Close
            </Button>
          </div>
        </PopoverContent>
      </Popover>
      <p className="scout-muted">
        {open ? "Popover is open." : "Popover is closed."}
      </p>
    </div>
  );
}

export const Default: Story = {
  args: {},
  render: (args) => (
    <Popover {...args}>
      <PopoverTrigger asChild>
        <Button variant="outline">Match details</Button>
      </PopoverTrigger>
      <PopoverContent>
        <div className="scout-stack">
          <strong>Ahri · Mid · 12 / 2 / 9</strong>
          <p className="scout-muted">
            Ranked Solo/Duo on EUW1, 31 minutes, victory.
          </p>
        </div>
      </PopoverContent>
    </Popover>
  ),
};

export const WithForm: Story = {
  args: {},
  render: (args) => (
    <Popover {...args}>
      <PopoverTrigger asChild>
        <IconButton label="Filter matches" variant="ghost">
          <Filter />
        </IconButton>
      </PopoverTrigger>
      <PopoverContent>
        <div className="scout-stack">
          <Field>
            <Label htmlFor="popover-filter-summoner">Summoner</Label>
            <Input
              id="popover-filter-summoner"
              name="summoner"
              placeholder="Faker#KR1"
            />
          </Field>
          <Label className="scout-cluster" htmlFor="popover-filter-wins">
            <Checkbox id="popover-filter-wins" defaultChecked />
            <span>Wins only</span>
          </Label>
          <Button size="sm">Apply filter</Button>
        </div>
      </PopoverContent>
    </Popover>
  ),
};

export const AlignedEnd: Story = {
  args: {},
  render: (args) => (
    <div style={{ display: "flex", justifyContent: "flex-end" }}>
      <Popover {...args}>
        <PopoverTrigger asChild>
          <Button variant="outline">Ingest status</Button>
        </PopoverTrigger>
        <PopoverContent align="end" side="bottom">
          <div className="scout-stack">
            <strong>Last ingest 4 minutes ago</strong>
            <p className="scout-muted">
              218 matches projected into the report lake today.
            </p>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  ),
};

export const Controlled: Story = {
  parameters: { controls: { disable: true } },
  render: () => <ControlledPopover />,
};
