import type { Meta, StoryObj } from "@storybook/react-vite";
import { ScoutClientHistoryView } from "./scout-client-history.tsx";
import { recoveredGamesFixture } from "./scout-client-history.fixture.ts";

const meta = {
  title: "Routes/Scout Client History",
  component: ScoutClientHistoryView,
  args: { data: recoveredGamesFixture },
} satisfies Meta<typeof ScoutClientHistoryView>;
export default meta;
type Story = StoryObj<typeof meta>;
export const RecoveredGames: Story = {};
export const Empty: Story = { args: { data: { results: [], conflicts: [] } } };
