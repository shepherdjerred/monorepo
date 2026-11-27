import type { Meta, StoryObj } from "@storybook/react-vite";
import { storySets } from "#src/domain/tips/generated-tips.fixtures.ts";
import { TipStage } from "#src/domain/tips/generated-tips.stage.tsx";
import { TipText, type TipTooltipExtras } from "#src/domain/tips/tip-text.tsx";
import type { OutputTip } from "@scout-for-lol/data/tips/output/champion-tips.ts";

const meta = {
  title: "Domain/TipText",
  tags: ["autodocs"],
  parameters: { layout: "fullscreen" },
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

const shownTips: readonly OutputTip[] = storySets
  .flatMap((set) => set.tips)
  .filter((tip) => tip.hidden !== true);

function firstTip(kind: OutputTip["refs"][number]["kind"]): OutputTip {
  const tip = shownTips.find((candidate) =>
    candidate.refs.some((ref) => ref.kind === kind),
  );
  if (tip === undefined) {
    throw new Error(`No generated tip names a ${kind}`);
  }
  return tip;
}

const longestTip: OutputTip = shownTips.reduce((longest, tip) =>
  tip.text.length > longest.text.length ? tip : longest,
);

/** Opens the layer of the tip's first reference of `kind`; the rest stay closed. */
function openFirst(
  tip: OutputTip,
  kind: OutputTip["refs"][number]["kind"],
  presentation: "popover" | "sheet",
): TipTooltipExtras {
  const first = tip.refs.find((ref) => ref.kind === kind);
  return (refKind, key) =>
    refKind === kind && key === first?.key
      ? { defaultOpen: true, presentation }
      : undefined;
}

/** Closed until the reader hovers, focuses or taps a phrase. */
export const Keyword: Story = {
  render: () => {
    const tip = firstTip("keyword");
    return (
      <TipStage>
        <TipText text={tip.text} refs={tip.refs} />
      </TipStage>
    );
  },
};

export const Ability: Story = {
  render: () => {
    const tip = firstTip("ability");
    return (
      <TipStage>
        <TipText text={tip.text} refs={tip.refs} />
      </TipStage>
    );
  },
};

export const Champion: Story = {
  render: () => {
    const tip = firstTip("champion");
    return (
      <TipStage>
        <TipText text={tip.text} refs={tip.refs} />
      </TipStage>
    );
  },
};

/** The keyword's tooltip open beside its phrase. */
export const KeywordOpen: Story = {
  render: () => {
    const tip = firstTip("keyword");
    return (
      <TipStage>
        <TipText
          text={tip.text}
          refs={tip.refs}
          tooltipExtras={openFirst(tip, "keyword", "popover")}
        />
      </TipStage>
    );
  },
};

/** On a phone a tap opens the same tooltip as a bottom sheet. */
export const PhoneSheet: Story = {
  render: () => {
    const tip = firstTip("ability");
    return (
      <TipStage width="24.375rem">
        <TipText
          text={tip.text}
          refs={tip.refs}
          tooltipExtras={openFirst(tip, "ability", "sheet")}
        />
      </TipStage>
    );
  },
};

/** The longest tip in the generated files, 160 characters, in a phone's width. */
export const LongText: Story = {
  render: () => (
    <TipStage width="24.375rem">
      <TipText text={longestTip.text} refs={longestTip.refs} />
    </TipStage>
  ),
};

/** Tips with no reference are plain text. */
export const NoReferences: Story = {
  render: () => {
    const tip = shownTips.find((candidate) => candidate.refs.length === 0);
    if (tip === undefined) {
      throw new Error("Every generated tip names an entity");
    }
    return (
      <TipStage>
        <TipText text={tip.text} refs={tip.refs} />
      </TipStage>
    );
  },
};
