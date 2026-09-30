import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "@scout-for-lol/design-system/components/button";
import { Section } from "./section.tsx";

const meta = {
  title: "Chrome/Section",
  component: Section,
  tags: ["autodocs"],
} satisfies Meta<typeof Section>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    title: "Recorded matches",
    children: (
      <p className="p-3 text-sm text-scout-subtle">
        Twelve matches recorded across Ranked Solo/Duo this week.
      </p>
    ),
  },
};

export const WithAction: Story = {
  args: {
    title: "Subscriptions",
    action: <Button size="sm">Add subscription</Button>,
    children: (
      <p className="p-3 text-sm text-scout-subtle">
        Two channels receive this guild&apos;s weekly report.
      </p>
    ),
  },
};
