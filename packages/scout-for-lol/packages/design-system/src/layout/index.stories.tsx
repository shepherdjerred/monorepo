import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  Callout,
  Cluster,
  Container,
  EmptyState,
  GlobalFooter,
  Grid,
  MarketingHeader,
  PageHeader,
  Panel,
  Section,
  Stack,
} from "./index.tsx";
import { Badge } from "#src/components/badge.tsx";
import { Button } from "#src/components/button.tsx";

const meta = {
  title: "Layout",
  component: Container,
  tags: ["autodocs"],
} satisfies Meta<typeof Container>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Containers: Story = {
  args: { children: "unused" },
  render: () => (
    <Container>
      <p>
        Container centers a surface and caps its measure. Every Scout page —
        marketing, docs, and the app dashboard — shares this gutter.
      </p>
    </Container>
  ),
};

export const Stacks: Story = {
  args: { children: "unused" },
  render: () => (
    <Stack>
      <h2>Weekly ranked report</h2>
      <p>Stack applies one vertical rhythm to whatever it wraps.</p>
      <p>Twelve matches recorded across three tracked summoners.</p>
    </Stack>
  ),
};

export const Clusters: Story = {
  args: { children: "unused" },
  render: () => (
    <Cluster>
      <Badge>Ranked Solo</Badge>
      <Badge variant="secondary">Flex</Badge>
      <Badge variant="outline">Arena</Badge>
      <Button size="sm">Add queue</Button>
    </Cluster>
  ),
};

export const Grids: Story = {
  args: { children: "unused" },
  render: () => (
    <Grid>
      <Panel>
        <Stack>
          <h2>Matches</h2>
          <p>128 ingested this week</p>
        </Stack>
      </Panel>
      <Panel>
        <Stack>
          <h2>Subscriptions</h2>
          <p>6 Discord channels receiving reports</p>
        </Stack>
      </Panel>
      <Panel>
        <Stack>
          <h2>Tracked players</h2>
          <p>19 summoners across 2 guilds</p>
        </Stack>
      </Panel>
    </Grid>
  ),
};

export const Sections: Story = {
  args: { children: "unused" },
  render: () => (
    <Section>
      <Container>
        <Stack>
          <h2>Prematch insight</h2>
          <p>
            Section owns vertical page spacing; Container owns horizontal
            measure. They compose rather than overlap.
          </p>
        </Stack>
      </Container>
    </Section>
  ),
};

export const Panels: Story = {
  args: { children: "unused" },
  render: () => (
    <Panel>
      <Stack>
        <h2>Report delivery</h2>
        <p>
          Panel is the raised surface used for dashboard cards, sidebars, and
          settings groups.
        </p>
      </Stack>
    </Panel>
  ),
};

export const Callouts: Story = {
  args: { children: "unused" },
  render: () => (
    <Callout>
      Scout only reads match data for summoners a guild administrator has
      linked.
    </Callout>
  ),
};

export const PageHeaders: Story = {
  args: { children: "unused" },
  render: () => (
    <PageHeader>
      <Stack>
        <h1>Reports</h1>
        <p>Scheduled recaps published to the Discord channels you choose.</p>
      </Stack>
      <Cluster>
        <Button>New report</Button>
        <Button variant="outline">Import</Button>
      </Cluster>
    </PageHeader>
  ),
};

export const EmptyStates: Story = {
  args: { children: "unused" },
  render: () => (
    <EmptyState>
      <Stack>
        <h2>No reports yet</h2>
        <p>Create a report to start publishing ranked recaps to Discord.</p>
        <Cluster>
          <Button size="sm">Create report</Button>
        </Cluster>
      </Stack>
    </EmptyState>
  ),
};

export const MarketingHeaderBar: Story = {
  args: { children: "unused" },
  render: () => <MarketingHeader landmark="div" currentPath="/" />,
};

export const MarketingHeaderSignedIn: Story = {
  args: { children: "unused" },
  render: () => (
    <MarketingHeader landmark="div" currentPath="/support" signedIn />
  ),
};

export const GlobalFooterBar: Story = {
  args: { children: "unused" },
  render: () => <GlobalFooter release="storybook" />,
};
