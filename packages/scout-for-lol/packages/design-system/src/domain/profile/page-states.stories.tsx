import type { Meta, StoryObj } from "@storybook/react-vite";
import { Chip } from "#src/components/surfaces/chip.tsx";
import { PageLoading, PageState } from "./page-states.tsx";

const meta = {
  title: "Domain/PageStates",
  component: PageState,
  tags: ["autodocs"],
  args: {
    kind: "empty",
    id: "state-title",
    title: "Lately",
    lead: "No games yet",
  },
  decorators: [(story) => <div style={{ maxWidth: "52rem" }}>{story()}</div>],
} satisfies Meta<typeof PageState>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Empty: Story = {
  args: {
    detail: "Scout starts keeping track from the next game Northstar finishes.",
    actions: (
      <>
        <Chip variant="go" href="#add">
          Add a Riot account
        </Chip>
        <Chip variant="ghost" href="#who">
          See who&apos;s playing in Rift Study Group
        </Chip>
      </>
    ),
  },
};

export const EmptyWithoutActions: Story = {};

export const NotFound: Story = {
  args: {
    kind: "not-found",
    id: "nf-title",
    level: 1,
    title: "Player not found",
    lead: "No one called Northstar here",
    actions: (
      <Chip variant="go" href="#find">
        Find another player
      </Chip>
    ),
  },
};

export const Unavailable: Story = {
  args: {
    kind: "unavailable",
    id: "un-title",
    title: "Lately",
    lead: "Games are unavailable right now",
    detail: "Updates when the game ends.",
    actions: <Chip href="#retry">Try again</Chip>,
  },
};

export const LongText: Story = {
  args: {
    kind: "not-found",
    id: "long-title",
    title: "A summoner with a name that is much too long to sit on one line",
    lead: "We could not find anyone with that name in any of your servers",
    detail: "Searched 4 servers in 3 regions.",
    actions: (
      <>
        <Chip variant="go" href="#find">
          Find another player
        </Chip>
        <Chip variant="ghost" href="#home">
          Back to Home
        </Chip>
      </>
    ),
  },
};

export const LoadingPanel: Story = {
  parameters: { controls: { disable: true } },
  render: () => <PageLoading />,
};

export const LoadingList: Story = {
  parameters: { controls: { disable: true } },
  render: () => <PageLoading shape="list" rows={5} label="Loading players" />,
};
