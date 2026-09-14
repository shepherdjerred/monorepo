import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  AugmentIcon,
  ChampionLoadingArt,
  ChampionPortrait,
  ChampionSplashArt,
  GameAssetImage,
  ItemIcon,
  LaneIcon,
  RankCrest,
  RuneIcon,
  SCOUT_RANKS,
  SummonerSpellIcon,
} from "./index.tsx";

const meta = {
  title: "Assets",
  component: ChampionPortrait,
  tags: ["autodocs"],
} satisfies Meta<typeof ChampionPortrait>;

export default meta;

type Story = StoryObj<typeof meta>;

const portraitStyle = { width: 96, height: 96 } as const;
const iconStyle = { width: 48, height: 48 } as const;
const crestStyle = { width: 64, height: 64 } as const;
const artStyle = { width: "100%", height: "auto" } as const;

export const Portrait: Story = {
  args: { champion: "Ahri" },
  render: () => <ChampionPortrait champion="Ahri" style={portraitStyle} />,
};

export const PortraitById: Story = {
  args: { champion: 64 },
  render: () => <ChampionPortrait champion={64} style={portraitStyle} />,
};

export const PortraitRow: Story = {
  args: { champion: "Ahri" },
  render: () => (
    <div className="scout-cluster">
      {["Ahri", "Aatrox", "Jinx", "LeeSin", "Thresh"].map((champion) => (
        <ChampionPortrait
          key={champion}
          champion={champion}
          style={portraitStyle}
        />
      ))}
    </div>
  ),
};

export const LoadingArt: Story = {
  args: { champion: "Aatrox" },
  render: () => (
    <ChampionLoadingArt
      champion="Aatrox"
      style={{ width: 308, height: "auto" }}
    />
  ),
};

export const SplashArt: Story = {
  args: { champion: "Jinx" },
  render: () => (
    <ChampionSplashArt
      champion="Jinx"
      alt="Jinx splash artwork from League of Legends"
      style={artStyle}
    />
  ),
};

export const MissingChampion: Story = {
  args: { champion: "Ahri" },
  render: () => (
    <ChampionPortrait
      champion="NotAChampion"
      optional
      alt="Champion portrait unavailable"
      style={portraitStyle}
    />
  ),
};

export const Items: Story = {
  args: { champion: "Ahri" },
  render: () => (
    <div className="scout-cluster">
      <ItemIcon item="1001" alt="Boots" style={iconStyle} />
      <ItemIcon item="1026" alt="Blasting Wand" style={iconStyle} />
      <ItemIcon item="1031" alt="Chain Vest" style={iconStyle} />
    </div>
  ),
};

export const Runes: Story = {
  args: { champion: "Ahri" },
  render: () => (
    <div className="scout-cluster">
      <RuneIcon rune="ArcaneComet" alt="Arcane Comet rune" style={iconStyle} />
      <RuneIcon rune="AbsorbLife" alt="Absorb Life rune" style={iconStyle} />
      <RuneIcon rune="7202_Sorcery" alt="Sorcery rune path" style={iconStyle} />
    </div>
  ),
};

export const SummonerSpells: Story = {
  args: { champion: "Ahri" },
  render: () => (
    <div className="scout-cluster">
      <SummonerSpellIcon
        spell="SummonerBarrier"
        alt="Barrier summoner spell"
        style={iconStyle}
      />
      <SummonerSpellIcon
        spell="SummonerBoost"
        alt="Cleanse summoner spell"
        style={iconStyle}
      />
      <SummonerSpellIcon
        spell="SummonerExhaust"
        alt="Exhaust summoner spell"
        style={iconStyle}
      />
    </div>
  ),
};

export const Augments: Story = {
  args: { champion: "Ahri" },
  render: () => (
    <div className="scout-cluster">
      <AugmentIcon
        augment="acceleratingsorcery_small"
        alt="Accelerating Sorcery augment"
        style={iconStyle}
      />
      <AugmentIcon
        augment="adapt_large"
        alt="Adapt augment"
        style={iconStyle}
      />
    </div>
  ),
};

export const Lanes: Story = {
  args: { champion: "Ahri" },
  render: () => (
    <div className="scout-cluster">
      <LaneIcon lane="top" alt="Top lane" style={iconStyle} />
      <LaneIcon lane="jungle" alt="Jungle role" style={iconStyle} />
      <LaneIcon lane="middle" alt="Middle lane" style={iconStyle} />
      <LaneIcon lane="adc" alt="Bottom lane" style={iconStyle} />
      <LaneIcon lane="support" alt="Support role" style={iconStyle} />
    </div>
  ),
};

export const GenericAsset: Story = {
  args: { champion: "Ahri" },
  render: () => (
    <GameAssetImage
      kind="background"
      assetKey="classic-jade"
      alt="Classic jade report background"
      crop="cover"
      style={artStyle}
    />
  ),
};

export const RankCrests: Story = {
  args: { champion: "Ahri" },
  render: () => (
    <div className="scout-cluster">
      {SCOUT_RANKS.map((rank) => (
        <RankCrest key={rank} rank={rank} style={crestStyle} />
      ))}
    </div>
  ),
};

export const RankCrestSingle: Story = {
  args: { champion: "Ahri" },
  render: () => (
    <RankCrest
      rank="Challenger"
      alt="Challenger rank crest"
      style={{ width: 128, height: 128 }}
    />
  ),
};
