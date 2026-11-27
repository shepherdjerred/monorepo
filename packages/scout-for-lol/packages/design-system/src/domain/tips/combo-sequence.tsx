import { ChevronRight, Sword } from "lucide-react";
import { GameAssetImage } from "#src/assets/index.tsx";
import { RichTooltip } from "#src/components/overlays/rich-tooltip.tsx";
import type { TipTooltipExtras } from "#src/domain/tips/tip-text.tsx";
import {
  FactImage,
  TooltipBody,
  TooltipHeader,
} from "#src/domain/tooltips/entity-tooltip-parts.tsx";
import { GameFactTooltip } from "#src/domain/tooltips/entity-tooltip.tsx";
import { useGameFact } from "#src/domain/tooltips/game-fact.tsx";
import { getBrowserChampionName } from "@scout-for-lol/data/browser-assets";
import type { OutputComboStep } from "@scout-for-lol/data/tips/output/champion-tips.ts";

/** Where a step's icon comes from: a regular row, or the small one in a matchup. */
export type ComboSequenceSize = "regular" | "compact";

/** "Ahri-E" is Ahri's E; "MonkeyKing-passive" is Wukong's passive. */
export function abilityStepLabel(key: string): string {
  const split = key.lastIndexOf("-");
  if (split <= 0) {
    throw new Error(`Ability key ${key} is not <champion>-<slot>`);
  }
  return `${getBrowserChampionName(key.slice(0, split))} ${key.slice(split + 1)}`;
}

function AbilityStep(props: {
  stepKey: string;
  extras?: TipTooltipExtras | undefined;
}) {
  const label = abilityStepLabel(props.stepKey);
  return (
    <GameFactTooltip
      kind="ability"
      factKey={props.stepKey}
      label={label}
      {...props.extras?.("ability", props.stepKey)}
    >
      <button type="button" className="scout-combo-step" aria-label={label}>
        <GameAssetImage kind="ability" assetKey={props.stepKey} alt="" />
      </button>
    </GameFactTooltip>
  );
}

/**
 * An item or a summoner spell: the step names it by numeric id, and its icon
 * is the one its game fact carries, so the icon waits for the fact.
 */
function FactStep(props: {
  kind: "item" | "summoner-spell";
  stepKey: string;
  extras?: TipTooltipExtras | undefined;
}) {
  const { kind, stepKey } = props;
  const state = useGameFact(kind, stepKey);
  const fact = state.status === "ready" ? state.fact : undefined;
  const label =
    fact === undefined
      ? `${kind === "item" ? "Item" : "Summoner spell"} ${stepKey}`
      : fact.name;
  const icon = fact !== undefined && "icon" in fact ? fact.icon : null;
  return (
    <GameFactTooltip
      kind={kind}
      factKey={stepKey}
      label={label}
      {...props.extras?.(kind, stepKey)}
    >
      <button type="button" className="scout-combo-step" aria-label={label}>
        {fact === undefined || icon === null ? (
          <span className="scout-combo-step__pending" />
        ) : (
          <FactImage patch={fact.patch} path={icon} size={40} />
        )}
      </button>
    </GameFactTooltip>
  );
}

function AttackStep() {
  return (
    <RichTooltip
      label="Basic attack"
      content={
        <TooltipBody>
          <TooltipHeader name="Basic attack" kind="Attack" />
        </TooltipBody>
      }
    >
      <button
        type="button"
        className="scout-combo-step scout-combo-step--attack"
        aria-label="Basic attack"
      >
        <Sword size={20} aria-hidden="true" />
      </button>
    </RichTooltip>
  );
}

function ComboStep(props: {
  step: OutputComboStep;
  extras?: TipTooltipExtras | undefined;
}) {
  const { step } = props;
  if (step === "attack") return <AttackStep />;
  return step.kind === "ability" ? (
    <AbilityStep stepKey={step.key} extras={props.extras} />
  ) : (
    <FactStep kind={step.kind} stepKey={step.key} extras={props.extras} />
  );
}

const stepId = (step: OutputComboStep): string =>
  step === "attack" ? "attack" : `${step.kind}-${step.key}`;

/**
 * A combo as icons in order, a chevron between steps. Each step is a tooltip
 * trigger: an ability, an item or a summoner spell opens its game fact, and an
 * attack opens a one-line note. Must sit inside a `GameFactProvider`.
 */
export function ComboSequence(props: {
  steps: readonly OutputComboStep[];
  size?: ComboSequenceSize;
  tooltipExtras?: TipTooltipExtras | undefined;
  className?: string | undefined;
}) {
  const { steps, size = "regular", tooltipExtras, className } = props;
  return (
    <ol
      className={
        className === undefined
          ? "scout-combo-sequence"
          : `scout-combo-sequence ${className}`
      }
      data-size={size}
    >
      {steps.map((step, index) => (
        <li key={`${index.toString()}-${stepId(step)}`}>
          <ComboStep step={step} extras={tooltipExtras} />
          {index < steps.length - 1 ? (
            <ChevronRight
              className="scout-combo-sequence__chevron"
              size={16}
              aria-hidden="true"
            />
          ) : null}
        </li>
      ))}
    </ol>
  );
}
