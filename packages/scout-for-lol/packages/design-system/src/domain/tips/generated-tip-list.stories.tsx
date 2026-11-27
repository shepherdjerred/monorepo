import type { Meta, StoryObj } from "@storybook/react-vite";
import { ComboRow } from "#src/domain/tips/combo-row.tsx";
import {
  GeneratedTipList,
  type GeneratedTipReverse,
} from "#src/domain/tips/generated-tip-list.tsx";
import {
  ahriIntoZed,
  ahriMiddle,
  cassiopeiaIntoTalon,
  jaxIntoTalon,
  jaxJungle,
  storySets,
  talonIntoCassiopeia,
  talonIntoJax,
  talonIntoWarwick,
  warwickIntoTalon,
  zedIntoAhri,
} from "#src/domain/tips/generated-tips.fixtures.ts";
import { TipStage } from "#src/domain/tips/generated-tips.stage.tsx";
import type { TipTooltipExtras } from "#src/domain/tips/tip-text.tsx";
import type { OutputTip } from "@scout-for-lol/data/tips/output/champion-tips.ts";

const meta = {
  title: "Domain/GeneratedTipList",
  tags: ["autodocs"],
  parameters: { layout: "fullscreen" },
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

const reverse = (
  label: string,
  champion: string,
  tips: readonly OutputTip[],
): GeneratedTipReverse => ({ label, champion, tips });

/** Ahri's general tips. Her set has no combos, so nothing follows the tips. */
export const AhriGeneral: Story = {
  render: () => (
    <TipStage>
      <GeneratedTipList tips={ahriMiddle.tips} />
      {ahriMiddle.combos.map((combo) => (
        <ComboRow key={combo.id} combo={combo} />
      ))}
    </TipStage>
  ),
};

export const AhriIntoZed: Story = {
  render: () => (
    <TipStage>
      <GeneratedTipList
        tips={ahriIntoZed.tips}
        reverse={reverse("Playing Zed into Ahri", "Zed", zedIntoAhri.tips)}
      />
    </TipStage>
  ),
};

export const JaxGeneral: Story = {
  render: () => (
    <TipStage>
      <GeneratedTipList tips={jaxJungle.tips} />
    </TipStage>
  ),
};

export const JaxIntoTalon: Story = {
  render: () => (
    <TipStage>
      <GeneratedTipList
        tips={jaxIntoTalon.tips}
        reverse={reverse("Playing Talon into Jax", "Talon", talonIntoJax.tips)}
      />
    </TipStage>
  ),
};

export const WarwickIntoTalon: Story = {
  render: () => (
    <TipStage>
      <GeneratedTipList
        tips={warwickIntoTalon.tips}
        reverse={reverse(
          "Playing Talon into Warwick",
          "Talon",
          talonIntoWarwick.tips,
        )}
      />
    </TipStage>
  ),
};

/** The set carries one hidden tip, which stays in the file and off the page. */
export const HiddenTipLeftOut: Story = {
  render: () => (
    <TipStage>
      <GeneratedTipList
        tips={talonIntoCassiopeia.tips}
        reverse={reverse(
          "Playing Cassiopeia into Talon",
          "Cassiopeia",
          cassiopeiaIntoTalon.tips,
        )}
      />
    </TipStage>
  ),
};

/** The other side's row opened, its tips in the same list. */
export const ReverseOpen: Story = {
  render: () => (
    <TipStage>
      <GeneratedTipList
        tips={ahriIntoZed.tips}
        reverse={reverse("Playing Zed into Ahri", "Zed", zedIntoAhri.tips)}
      />
    </TipStage>
  ),
  play: ({ canvasElement }) => {
    const flip = canvasElement.querySelector("details");
    if (flip === null) throw new Error("The reverse side is not rendered");
    flip.open = true;
  },
};

const longest: readonly OutputTip[] = storySets
  .flatMap((set) => set.tips)
  .filter((tip) => tip.hidden !== true)
  .toSorted((left, right) => right.text.length - left.text.length)
  .slice(0, 3);

/** The three longest tips in the generated files, in a phone's width. */
export const LongText: Story = {
  render: () => (
    <TipStage width="24.375rem">
      <GeneratedTipList tips={longest} />
    </TipStage>
  ),
};

const openFirstAbility: TipTooltipExtras = (kind, key) =>
  kind === "ability" && key === "Ahri-E"
    ? { defaultOpen: true, presentation: "sheet" }
    : undefined;

/** On a phone a tap on any phrase opens a bottom sheet; here Charm is open. */
export const PhoneSheet: Story = {
  render: () => {
    const charm = ahriMiddle.tips.find(
      (tip) => tip.refs.length === 1 && tip.refs[0]?.key === "Ahri-E",
    );
    if (charm === undefined) {
      throw new Error("No Ahri tip names only Charm");
    }
    return (
      <TipStage width="24.375rem">
        <GeneratedTipList tips={[charm]} tooltipExtras={openFirstAbility} />
      </TipStage>
    );
  },
};
