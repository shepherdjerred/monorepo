import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "./accordion.tsx";

const meta = {
  title: "Components/Accordion",
  component: Accordion,
  tags: ["autodocs"],
} satisfies Meta<typeof Accordion>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { type: "single", collapsible: true },
  render: () => (
    <Accordion type="single" collapsible defaultValue="ranked">
      <AccordionItem value="ranked">
        <AccordionTrigger>Ranked solo queue</AccordionTrigger>
        <AccordionContent>
          Emerald II, 47 LP. Won 6 of the last 10 games on Ahri and Syndra.
        </AccordionContent>
      </AccordionItem>
      <AccordionItem value="flex">
        <AccordionTrigger>Ranked flex</AccordionTrigger>
        <AccordionContent>
          Platinum IV, 12 LP. Duo partner is queued as support on Nautilus.
        </AccordionContent>
      </AccordionItem>
      <AccordionItem value="aram">
        <AccordionTrigger>ARAM</AccordionTrigger>
        <AccordionContent>
          No ranked ladder. 38 games played this patch, 62% win rate.
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  ),
};

export const Collapsed: Story = {
  args: { type: "single", collapsible: true },
  render: () => (
    <Accordion type="single" collapsible>
      <AccordionItem value="jungle">
        <AccordionTrigger>Jungle pathing notes</AccordionTrigger>
        <AccordionContent>
          Full clear into Rift Herald on Lee Sin, then reset for tier two boots.
        </AccordionContent>
      </AccordionItem>
      <AccordionItem value="vision">
        <AccordionTrigger>Vision score breakdown</AccordionTrigger>
        <AccordionContent>
          Averaging 1.4 wards per minute — top quartile for Emerald support.
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  ),
};

export const Multiple: Story = {
  args: { type: "multiple" },
  render: () => (
    <Accordion type="multiple" defaultValue={["baron", "dragon"]}>
      <AccordionItem value="baron">
        <AccordionTrigger>Baron Nashor</AccordionTrigger>
        <AccordionContent>
          Secured 2 of 3 Barons. Both were taken after a won mid lane fight.
        </AccordionContent>
      </AccordionItem>
      <AccordionItem value="dragon">
        <AccordionTrigger>Dragon soul</AccordionTrigger>
        <AccordionContent>
          Ocean soul at 27:10. Team took four dragons without contest.
        </AccordionContent>
      </AccordionItem>
      <AccordionItem value="herald">
        <AccordionTrigger>Rift Herald</AccordionTrigger>
        <AccordionContent>
          Both Heralds used bot side, opening the tier one turret by 11:00.
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  ),
};

export const SingleItem: Story = {
  args: { type: "single", collapsible: true },
  render: () => (
    <Accordion type="single" collapsible defaultValue="subscription">
      <AccordionItem value="subscription">
        <AccordionTrigger>How do report subscriptions work?</AccordionTrigger>
        <AccordionContent>
          Scout posts a match report to your Discord channel whenever a
          subscribed summoner finishes a ranked game.
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  ),
};

export const DisabledItem: Story = {
  args: { type: "single", collapsible: true },
  render: () => (
    <Accordion type="single" collapsible defaultValue="match-history">
      <AccordionItem value="match-history">
        <AccordionTrigger>Match history</AccordionTrigger>
        <AccordionContent>
          Last 20 games ingested from the Riot match API.
        </AccordionContent>
      </AccordionItem>
      <AccordionItem value="champion-mastery" disabled>
        <AccordionTrigger>
          Champion mastery (linked account required)
        </AccordionTrigger>
        <AccordionContent>
          Link a Riot account in the Scout dashboard to unlock mastery data.
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  ),
};
