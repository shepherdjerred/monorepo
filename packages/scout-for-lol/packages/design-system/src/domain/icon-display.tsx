import type { ReactNode } from "react";
import {
  AugmentIcon,
  ItemIcon,
  LaneIcon,
  RuneIcon,
  SummonerSpellIcon,
} from "#src/assets/index.tsx";

function IconDisplay(props: {
  icon: ReactNode;
  label: string;
  detail?: string | undefined;
}) {
  return (
    <span className="scout-icon-display">
      {props.icon}
      <span>
        <strong>{props.label}</strong>
        {props.detail === undefined ? null : <small>{props.detail}</small>}
      </span>
    </span>
  );
}
export function ItemDisplay(props: {
  item: string | number;
  label: string;
  detail?: string | undefined;
}) {
  return (
    <IconDisplay
      label={props.label}
      detail={props.detail}
      icon={
        <ItemIcon item={props.item} alt="" style={{ width: 32, height: 32 }} />
      }
    />
  );
}
export function RuneDisplay(props: {
  rune: string | number;
  label: string;
  detail?: string | undefined;
}) {
  return (
    <IconDisplay
      label={props.label}
      detail={props.detail}
      icon={
        <RuneIcon rune={props.rune} alt="" style={{ width: 32, height: 32 }} />
      }
    />
  );
}
export function SpellDisplay(props: {
  spell: string | number;
  label: string;
  detail?: string | undefined;
}) {
  return (
    <IconDisplay
      label={props.label}
      detail={props.detail}
      icon={
        <SummonerSpellIcon
          spell={props.spell}
          alt=""
          style={{ width: 32, height: 32 }}
        />
      }
    />
  );
}
export function AugmentDisplay(props: {
  augment: string | number;
  label: string;
  detail?: string | undefined;
}) {
  return (
    <IconDisplay
      label={props.label}
      detail={props.detail}
      icon={
        <AugmentIcon
          augment={props.augment}
          alt=""
          style={{ width: 32, height: 32 }}
        />
      }
    />
  );
}
export function LaneDisplay(props: {
  lane: string;
  label?: string | undefined;
}) {
  return (
    <IconDisplay
      label={props.label ?? props.lane}
      icon={
        <LaneIcon lane={props.lane} alt="" style={{ width: 32, height: 32 }} />
      }
    />
  );
}
