import type { Meta, StoryObj } from "@storybook/react-vite";
import { Chip } from "#src/components/surfaces/chip.tsx";
import {
  BottomSheet,
  BottomSheetClose,
  BottomSheetContent,
  BottomSheetTrigger,
} from "./bottom-sheet.tsx";

const meta = {
  title: "Components/Overlays/BottomSheet",
  component: BottomSheet,
  tags: ["autodocs"],
} satisfies Meta<typeof BottomSheet>;

export default meta;

type Story = StoryObj<typeof meta>;

const filters = ["Ranked Solo", "Ranked Flex", "Normal", "ARAM"] as const;

export const Default: Story = {
  args: {},
  render: (args) => (
    <BottomSheet {...args}>
      <BottomSheetTrigger asChild>
        <Chip variant="float">More filters</Chip>
      </BottomSheetTrigger>
      <BottomSheetContent title="More filters">
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
          {filters.map((filter) => (
            <Chip key={filter} pressed={filter === "Ranked Solo"}>
              {filter}
            </Chip>
          ))}
        </div>
        <div style={{ marginTop: "1.5rem" }}>
          <BottomSheetClose asChild>
            <Chip variant="go">Apply</Chip>
          </BottomSheetClose>
        </div>
      </BottomSheetContent>
    </BottomSheet>
  ),
};

export const DefaultOpen: Story = {
  args: { defaultOpen: true },
  render: (args) => (
    <BottomSheet {...args}>
      <BottomSheetTrigger asChild>
        <Chip variant="float">Match details</Chip>
      </BottomSheetTrigger>
      <BottomSheetContent title="Match details">
        <ul className="scout-stack">
          <li>Duration: 31:42</li>
          <li>Queue: Ranked Solo</li>
          <li>Result: Victory</li>
        </ul>
      </BottomSheetContent>
    </BottomSheet>
  ),
};
