import type { Meta, StoryObj } from "@storybook/react-vite";
import { ComboRef, ComboRow } from "#src/domain/tips/combo-row.tsx";
import {
  cassiopeiaMiddle,
  jaxJungle,
  jaxStandInComboRef,
  jaxTop,
  storySets,
  talonJungle,
  warwickJungle,
} from "#src/domain/tips/generated-tips.fixtures.ts";
import { TipStage } from "#src/domain/tips/generated-tips.stage.tsx";
import type { TipTooltipExtras } from "#src/domain/tips/tip-text.tsx";
import type { OutputCombo } from "@scout-for-lol/data/tips/output/champion-tips.ts";

const meta = {
  title: "Domain/ComboRow",
  tags: ["autodocs"],
  parameters: { layout: "fullscreen" },
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

function Combos(props: {
  combos: readonly OutputCombo[];
  tooltipExtras?: TipTooltipExtras | undefined;
}) {
  return (
    <div>
      {props.combos.map((combo) => (
        <ComboRow
          key={combo.id}
          combo={combo}
          tooltipExtras={props.tooltipExtras}
        />
      ))}
    </div>
  );
}

export const Jax: Story = {
  render: () => (
    <TipStage>
      <Combos combos={jaxTop.combos} />
    </TipStage>
  ),
};

/** Three ability steps and a basic attack. */
export const WarwickWithAttack: Story = {
  render: () => (
    <TipStage>
      <Combos combos={warwickJungle.combos} />
    </TipStage>
  ),
};

export const Talon: Story = {
  render: () => (
    <TipStage>
      <Combos combos={talonJungle.combos} />
    </TipStage>
  ),
};

/** A summoner spell is a step: Flash, then the ultimate. */
export const SummonerSpellStep: Story = {
  render: () => (
    <TipStage>
      <Combos combos={cassiopeiaMiddle.combos} />
    </TipStage>
  ),
};

const longest: OutputCombo = storySets
  .flatMap((set) => ("combos" in set ? set.combos : []))
  .reduce((best, combo) =>
    combo.text.length + combo.when.length > best.text.length + best.when.length
      ? combo
      : best,
  );

/** The longest combo in the generated files, in a phone's width. */
export const LongText: Story = {
  render: () => (
    <TipStage width="24.375rem">
      <Combos combos={[longest]} />
    </TipStage>
  ),
};

const openFirstStep: TipTooltipExtras = (kind, key) =>
  kind === "ability" && key === "Jax-E"
    ? { defaultOpen: true, presentation: "sheet" }
    : undefined;

/** On a phone a tap on a step opens a bottom sheet. */
export const PhoneSheet: Story = {
  render: () => {
    const combo = jaxJungle.combos.find(
      (candidate) =>
        candidate.sequence.filter(
          (step) =>
            step !== "attack" &&
            step.kind === "ability" &&
            step.key === "Jax-E",
        ).length === 1,
    );
    if (combo === undefined) throw new Error("Jax has no combo with his E");
    return (
      <TipStage width="24.375rem">
        <Combos combos={[combo]} tooltipExtras={openFirstStep} />
      </TipStage>
    );
  },
};

/** A matchup side pointing at one of its champion's combos, with its note. */
export const Reference: Story = {
  render: () => (
    <TipStage>
      <ComboRef comboRef={jaxStandInComboRef} combos={jaxJungle.combos} />
    </TipStage>
  ),
};

export const ReferenceInPhoneWidth: Story = {
  render: () => (
    <TipStage width="24.375rem">
      <ComboRef comboRef={jaxStandInComboRef} combos={jaxJungle.combos} />
    </TipStage>
  ),
};
