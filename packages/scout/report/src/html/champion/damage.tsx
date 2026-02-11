import { palette } from "@shepherdjerred/scout-report/assets/colors.ts";
import { Damage as BaseDamage } from "@shepherdjerred/scout-report/html/shared/damage.tsx";

// TODO(https://github.com/shepherdjerred/scout-for-lol/issues/183): Add damage icon for better visual hierarchy
export function Damage(props: { value: number; percent: number; highlight: boolean }) {
  return (
    <BaseDamage
      {...props}
      containerGap="2rem"
      containerWidth="40rem"
      textGap="2rem"
      textFontWeight={700}
      textLayout="simple"
      barWidth="20rem"
      barHeight="1.5rem"
      barBackgroundColor={palette.grey[1]}
      fillHighlightColor={palette.gold.bright}
      fillDefaultColor={palette.white[1]}
    />
  );
}
