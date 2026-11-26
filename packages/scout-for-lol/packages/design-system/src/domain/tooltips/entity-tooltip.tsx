import { useCallback, type ReactElement } from "react";
import { RichTooltip } from "#src/components/overlays/rich-tooltip.tsx";
import {
  EntityTooltipBody,
  type EntityTooltipBodyExtras,
} from "#src/domain/tooltips/entity-tooltip-bodies.tsx";
import {
  PartContext,
  TooltipError,
  TooltipSkeleton,
} from "#src/domain/tooltips/entity-tooltip-parts.tsx";
import {
  useGameFact,
  useGameFactIntent,
} from "#src/domain/tooltips/game-fact.tsx";
import type {
  GameFact,
  GameFactKind,
  GameFactPart,
} from "@scout-for-lol/data/game-facts/schema.ts";

/** What the page adds to a tooltip: its own block, and the one link out. */
export type EntityTooltipExtras = EntityTooltipBodyExtras & {
  /**
   * Parts (`kind/key`, such as `ability/Ahri-E`) whose layers start open, to
   * show a layered tooltip in place.
   */
  defaultOpenParts?: readonly string[] | undefined;
  /** The same extras for a layer opened from one of this layer's parts. */
  resolvePart?: ((part: GameFactPart) => EntityTooltipBodyExtras) | undefined;
};

/**
 * The body for any fact, chosen by its kind, with each of its parts opening a
 * layer of its own. Must sit inside a `GameFactProvider`.
 */
export function EntityTooltip(props: EntityTooltipExtras & { fact: GameFact }) {
  const { fact, resolvePart, defaultOpenParts, ...extras } = props;
  const wrap = useCallback(
    (part: GameFactPart, trigger: ReactElement): ReactElement => (
      <GameFactTooltip
        kind={part.kind}
        factKey={part.key}
        label={part.name}
        resolvePart={resolvePart}
        defaultOpenParts={defaultOpenParts}
        defaultOpen={defaultOpenParts?.includes(`${part.kind}/${part.key}`)}
        {...resolvePart?.(part)}
      >
        {trigger}
      </GameFactTooltip>
    ),
    [resolvePart, defaultOpenParts],
  );
  return (
    <PartContext.Provider value={wrap}>
      <EntityTooltipBody fact={fact} {...extras} />
    </PartContext.Provider>
  );
}

function GameFactLayer(
  props: EntityTooltipExtras & {
    kind: GameFactKind;
    factKey: string;
    label: string;
  },
) {
  const { kind, factKey, label, ...extras } = props;
  const state = useGameFact(kind, factKey);
  switch (state.status) {
    case "loading":
      return <TooltipSkeleton />;
    case "error":
      return <TooltipError label={label} />;
    case "ready":
      return <EntityTooltip fact={state.fact} {...extras} />;
  }
}

/**
 * A trigger that opens the tooltip for one game entity. The fact is fetched as
 * the pointer settles on the trigger, so it is usually ready when the layer
 * opens; the layer shows a skeleton until it is, and one plain line if the
 * load fails.
 */
export function GameFactTooltip(
  props: EntityTooltipExtras & {
    kind: GameFactKind;
    /** The entity's key: a champion key, an ability `Ahri-E`, a numeric id. */
    factKey: string;
    /** The entity's name, for assistive technology and the error line. */
    label: string;
    /** The trigger element. */
    children: ReactElement;
    defaultOpen?: boolean | undefined;
    presentation?: "auto" | "popover" | "sheet" | undefined;
  },
) {
  const {
    kind,
    factKey,
    label,
    children,
    defaultOpen,
    presentation,
    ...extras
  } = props;
  const onIntent = useGameFactIntent(kind, factKey);
  return (
    <RichTooltip
      label={label}
      onIntent={onIntent}
      {...(defaultOpen === undefined ? {} : { defaultOpen })}
      {...(presentation === undefined ? {} : { presentation })}
      content={
        <GameFactLayer
          kind={kind}
          factKey={factKey}
          label={label}
          {...extras}
        />
      }
    >
      {children}
    </RichTooltip>
  );
}
