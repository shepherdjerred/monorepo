import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "@scout-for-lol/design-system/components/button";
import { OnboardingShell } from "./onboarding-shell.tsx";
import { OnboardingStepFrame } from "./onboarding-step-frame.tsx";
import { OnboardingConceptDiagram } from "./onboarding-concept-diagram.tsx";
import { OnboardingNoChannels } from "./onboarding-no-channels.tsx";

const meta = {
  title: "Onboarding/Frame",
  component: OnboardingShell,
  tags: ["autodocs"],
} satisfies Meta<typeof OnboardingShell>;

export default meta;

type Story = StoryObj<typeof meta>;

function noop(): void {
  // Story callbacks are deliberately inert.
}

export const Shell: Story = {
  args: {
    step: "subscribe-self",
    title: "Track your own account",
    description:
      "Add your League account so you get a report after every game you play.",
    onSkip: noop,
    children: (
      <p className="text-sm text-scout-subtle">
        The step body renders here — a form, a server list, or a summary card.
      </p>
    ),
  },
};

export const ShellWithoutSkip: Story = {
  args: {
    step: "done",
    title: "You're all set 🎉",
    description:
      "Scout will post a match report to your channel after every game your tracked players finish.",
    children: (
      <Button variant="outline" onClick={noop}>
        Finish
      </Button>
    ),
  },
};

export const StepFrameWithChannels: Story = {
  args: { step: "build-report", title: "unused", children: null },
  render: () => (
    <OnboardingStepFrame
      step="build-report"
      title="Set up a report"
      description="A report posts a leaderboard to a channel on a schedule. Tweak the example and create."
      hasChannels
      onBack={noop}
      onSkip={noop}
    >
      <p className="text-sm text-scout-subtle">
        The report form renders here once Scout can see a postable channel.
      </p>
    </OnboardingStepFrame>
  ),
};

export const StepFrameWithoutChannels: Story = {
  args: { step: "build-competition", title: "unused", children: null },
  render: () => (
    <OnboardingStepFrame
      step="build-competition"
      title="Start a competition"
      description="A competition is a time-boxed race where members rank on one metric. Tweak the example and create."
      hasChannels={false}
      onBack={noop}
      onSkip={noop}
    >
      <p className="text-sm text-scout-subtle">
        Never rendered — the frame swaps in the no-channels back-out instead.
      </p>
    </OnboardingStepFrame>
  ),
};

export const ConceptDiagram: Story = {
  args: { step: "concepts", title: "unused", children: null },
  render: () => <OnboardingConceptDiagram />,
};

export const NoChannels: Story = {
  args: { step: "subscribe-more", title: "unused", children: null },
  render: () => <OnboardingNoChannels onBack={noop} />,
};
