import type { Meta, StoryObj } from "@storybook/react-vite";
import { MoreHorizontal } from "lucide-react";
import { useState } from "react";
import { Button, IconButton } from "#src/components/button.tsx";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "./dropdown-menu.tsx";

const meta = {
  title: "Components/Overlays/DropdownMenu",
  component: DropdownMenu,
  tags: ["autodocs"],
} satisfies Meta<typeof DropdownMenu>;

export default meta;

type Story = StoryObj<typeof meta>;

function QueueFilterMenu() {
  const [queues, setQueues] = useState<readonly string[]>(["solo"]);

  function toggle(queue: string, checked: boolean): void {
    setQueues((current) =>
      checked
        ? [...current.filter((item) => item !== queue), queue]
        : current.filter((item) => item !== queue),
    );
  }

  return (
    <div className="scout-stack">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline">Queue filters</Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuLabel>Include queues</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuCheckboxItem
            checked={queues.includes("solo")}
            onCheckedChange={(checked) => {
              toggle("solo", checked);
            }}
          >
            Ranked Solo/Duo
          </DropdownMenuCheckboxItem>
          <DropdownMenuCheckboxItem
            checked={queues.includes("flex")}
            onCheckedChange={(checked) => {
              toggle("flex", checked);
            }}
          >
            Ranked Flex 5v5
          </DropdownMenuCheckboxItem>
          <DropdownMenuCheckboxItem
            checked={queues.includes("aram")}
            onCheckedChange={(checked) => {
              toggle("aram", checked);
            }}
          >
            ARAM
          </DropdownMenuCheckboxItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <p className="scout-muted">
        {queues.length === 0
          ? "No queues selected."
          : `Filtering on ${queues.join(", ")}.`}
      </p>
    </div>
  );
}

function RegionMenu() {
  const [region, setRegion] = useState("na1");
  return (
    <div className="scout-stack">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline">Routing region</Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuLabel>Riot platform</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuRadioGroup value={region} onValueChange={setRegion}>
            <DropdownMenuRadioItem value="na1">
              North America
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="euw1">
              Europe West
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="kr">Korea</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <p className="scout-muted">{`Match ingest routes through ${region}.`}</p>
    </div>
  );
}

export const Default: Story = {
  args: {},
  render: () => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline">Report actions</Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuGroup>
          <DropdownMenuItem>
            Re-render report
            <DropdownMenuShortcut>⌘R</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem>Copy share link</DropdownMenuItem>
          <DropdownMenuItem>Post to Discord</DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled>Export to CSV</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  ),
};

export const IconTrigger: Story = {
  args: {},
  render: () => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton label="Match options" variant="ghost">
          <MoreHorizontal />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuLabel>Match 4291847302</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem>Open scoreboard</DropdownMenuItem>
        <DropdownMenuItem>Re-ingest from Riot</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  ),
};

export const CheckboxItems: Story = {
  args: {},
  render: () => <QueueFilterMenu />,
};

export const RadioItems: Story = {
  args: {},
  render: () => <RegionMenu />,
};

export const Submenu: Story = {
  args: {},
  render: () => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline">Subscription</Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem>Edit schedule</DropdownMenuItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>Delivery channel</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuItem>#ranked-reports</DropdownMenuItem>
            <DropdownMenuItem>#highlights</DropdownMenuItem>
            <DropdownMenuItem>#bot-spam</DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        <DropdownMenuItem>Pause subscription</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  ),
};
