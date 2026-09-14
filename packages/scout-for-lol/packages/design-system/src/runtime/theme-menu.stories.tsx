import type { Meta, StoryObj } from "@storybook/react-vite";
import { ThemeMenu } from "./theme-menu.tsx";

const meta = {
  title: "Runtime/ThemeMenu",
  component: ThemeMenu,
  tags: ["autodocs"],
} satisfies Meta<typeof ThemeMenu>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = { args: {} };
