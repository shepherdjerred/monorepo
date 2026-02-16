import { Damage as BaseDamage } from "@scout-for-lol/report/html/shared/damage.tsx";

export function Damage(props: { value: number; percent: number; highlight: boolean }) {
  return (
    <BaseDamage
      {...props}
      containerGap={6}
      containerMinWidth={120}
      textGap={4}
      textFontSize={16}
      textFontWeight={600}
      textColor={props.highlight ? "#fbbf24" : "#d1d5db"}
      textLayout="split"
      barWidth={100}
      barHeight={12}
      barBackgroundColor="#5B5A56"
      barBorderRadius={2}
      barOverflow="hidden"
      fillHighlightColor="#fbbf24"
      fillDefaultColor="#d1d5db"
      fillBorderRadius={2}
    />
  );
}
