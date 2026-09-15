import type { Meta, StoryObj } from "@storybook/react-vite";
import { ChartNoAxesColumn, Radar, Swords } from "lucide-react";
import {
  AnnouncementBanner,
  CTA as Cta,
  FAQItem,
  FeatureCard,
  FeatureGrid,
  GalleryItem,
  Hero,
  ImageFeature,
  MarketingButton,
  ProcessStep,
  SectionHeader,
} from "./index.tsx";
import { ChampionSplashArt } from "#src/assets/index.tsx";
import { Badge } from "#src/components/badge.tsx";
import { Stack } from "#src/layout/index.tsx";

const meta = {
  title: "Marketing",
  component: Hero,
  tags: ["autodocs"],
} satisfies Meta<typeof Hero>;

export default meta;

type Story = StoryObj<typeof meta>;

const heroArgs = {
  title: "Know the match before it starts.",
  description: "unused",
} satisfies Parameters<typeof Hero>[0];

export const HeroSection: Story = {
  args: {
    eyebrow: <Badge>Live</Badge>,
    title: "Know the match before it starts.",
    description:
      "Scout watches your Discord server's ranked games and publishes a recap the moment the match ends.",
    primaryAction: (
      <MarketingButton href="/app/login">Get Started</MarketingButton>
    ),
    secondaryAction: (
      <MarketingButton href="/docs/" secondary>
        Read the docs
      </MarketingButton>
    ),
    media: (
      <ChampionSplashArt
        champion="Ahri"
        alt="Ahri splash artwork from League of Legends"
        style={{ width: "100%", height: "auto" }}
      />
    ),
  },
};

export const HeroWithoutMedia: Story = {
  args: {
    titleLevel: "h2",
    title: "Every ranked game, recapped in Discord.",
    description:
      "A nested hero drops to an h2 so it can sit inside a longer marketing page.",
    primaryAction: (
      <MarketingButton href="/app/login">Invite Scout</MarketingButton>
    ),
  },
};

export const CallToAction: Story = {
  args: heroArgs,
  parameters: { controls: { disable: true } },
  render: () => (
    <Cta
      title="Ready to scout?"
      description={
        <p>
          Add the bot, link a summoner, and the first recap lands after your
          next ranked game.
        </p>
      }
      action={<MarketingButton href="/app/login">Open Scout</MarketingButton>}
    />
  ),
};

export const Feature: Story = {
  args: heroArgs,
  parameters: { controls: { disable: true } },
  render: () => (
    <FeatureCard icon={<Radar aria-hidden="true" />} title="Prematch insight">
      See lanes, champions, and recent form for every player in champion select.
    </FeatureCard>
  ),
};

export const FeatureCards: Story = {
  args: heroArgs,
  parameters: { controls: { disable: true } },
  render: () => (
    <FeatureGrid>
      <FeatureCard icon={<Radar aria-hidden="true" />} title="Prematch insight">
        See lanes, champions, and recent form before you load in.
      </FeatureCard>
      <FeatureCard icon={<Swords aria-hidden="true" />} title="Match recaps">
        KDA, objectives, and rank movement posted to the channel you choose.
      </FeatureCard>
      <FeatureCard
        icon={<ChartNoAxesColumn aria-hidden="true" />}
        title="Season trends"
      >
        Track win rate by champion, queue, and patch across your whole guild.
      </FeatureCard>
    </FeatureGrid>
  ),
};

export const ProcessSteps: Story = {
  args: heroArgs,
  parameters: { controls: { disable: true } },
  render: () => (
    <Stack>
      <SectionHeader>
        <h2>How Scout works</h2>
      </SectionHeader>
      <ProcessStep number={1} title="Invite Scout">
        Connect the Discord server your team already plays in.
      </ProcessStep>
      <ProcessStep number={2} title="Link summoners">
        Riot IDs are verified once, then tracked automatically.
      </ProcessStep>
      <ProcessStep number={3} title="Get recaps">
        Reports publish to your chosen channel after every ranked game.
      </ProcessStep>
    </Stack>
  ),
};

export const FAQ: Story = {
  args: heroArgs,
  parameters: { controls: { disable: true } },
  render: () => (
    <Stack>
      <FAQItem value="queues" question="Which queues does Scout track?">
        Ranked Solo/Duo, Flex, Arena, and tournament-code custom games.
      </FAQItem>
      <FAQItem value="riot" question="Is Scout endorsed by Riot Games?">
        No. Scout is an independent League of Legends companion built on the
        public Riot API.
      </FAQItem>
    </Stack>
  ),
};

export const Gallery: Story = {
  args: heroArgs,
  parameters: { controls: { disable: true } },
  render: () => (
    <FeatureGrid>
      <GalleryItem
        image={
          <ChampionSplashArt
            champion="Jinx"
            alt="Jinx splash artwork from League of Legends"
            style={{ width: "100%", height: "auto" }}
          />
        }
        caption="Champion art resolves from the patch-pinned asset manifest."
      />
      <GalleryItem
        image={
          <ChampionSplashArt
            champion="Aatrox"
            alt="Aatrox splash artwork from League of Legends"
            style={{ width: "100%", height: "auto" }}
          />
        }
        caption="Captions stay optional so galleries can run image-only."
      />
    </FeatureGrid>
  ),
};

export const ImageFeatureSection: Story = {
  args: heroArgs,
  parameters: { controls: { disable: true } },
  render: () => (
    <ImageFeature
      image={
        <ChampionSplashArt
          champion="LeeSin"
          alt="Lee Sin splash artwork from League of Legends"
          style={{ width: "100%", height: "auto" }}
        />
      }
      title="Champion-aware surfaces"
    >
      <p>
        Existing champion keys resolve to same-origin art pinned to the patch
        Scout ingested.
      </p>
    </ImageFeature>
  ),
};

export const ImageFeatureReversed: Story = {
  args: heroArgs,
  parameters: { controls: { disable: true } },
  render: () => (
    <ImageFeature
      reverse
      image={
        <ChampionSplashArt
          champion="Ahri"
          alt="Ahri splash artwork from League of Legends"
          style={{ width: "100%", height: "auto" }}
        />
      }
      title="Alternating rhythm"
    >
      <p>The reverse flag flips media and copy without changing the markup.</p>
    </ImageFeature>
  ),
};

export const Announcement: Story = {
  args: heroArgs,
  parameters: { controls: { disable: true } },
  render: () => (
    <AnnouncementBanner>Scout 2.0 is available.</AnnouncementBanner>
  ),
};

export const AnnouncementLink: Story = {
  args: heroArgs,
  parameters: { controls: { disable: true } },
  render: () => (
    <AnnouncementBanner href="/whatsnew">
      Arena recaps are live — see what changed.
    </AnnouncementBanner>
  ),
};

export const SectionHeading: Story = {
  args: heroArgs,
  parameters: { controls: { disable: true } },
  render: () => (
    <SectionHeader>
      <h2>Built for the server you already play in</h2>
      <p className="scout-muted">
        No new app to install and no accounts for your teammates to create.
      </p>
    </SectionHeader>
  ),
};

export const Buttons: Story = {
  args: heroArgs,
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="scout-cluster">
      <MarketingButton href="/app/login" analyticsEvent="marketing_get_started">
        Get Started
      </MarketingButton>
      <MarketingButton href="/docs/" secondary>
        Read the docs
      </MarketingButton>
    </div>
  ),
};
