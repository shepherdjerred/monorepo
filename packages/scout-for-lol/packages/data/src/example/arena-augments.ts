import { AugmentSchema } from "@scout-for-lol/data";

export function createMasterOfDualityAugment() {
  return AugmentSchema.parse({
    id: 54,
    name: "Master of Duality",
    rarity: "gold",
    apiName: "MasterofDuality",
    desc: "Your Attacks grant you stacking Ability Power and your Abilities grant you Attack Damage.",
    tooltip:
      "Your Attacks grant you @APGained@ Ability Power and your Abilities grant you @ADGained@ Attack Damage, stacking infinitely until the end of the round.",
    iconLarge: "assets/ux/cherry/augments/icons/masterofduality_large.png",
    iconSmall: "assets/ux/cherry/augments/icons/masterofduality_small.png",
    calculations: {},
    dataValues: {},
    type: "full",
  });
}

export function createCourageAugment() {
  return AugmentSchema.parse({
    id: 18,
    name: "Courage of the Colossus",
    rarity: "gold",
    apiName: "CourageoftheColossus",
    desc: "Gain Shield after Immobilizing or Grounding an enemy champion.",
    tooltip: "Gain @TotalShield@ Shield after Immobilizing or Grounding an enemy champion.",
    iconLarge: "assets/ux/cherry/augments/icons/courageofthecolossus_large.png",
    iconSmall: "assets/ux/cherry/augments/icons/courageofthecolossus_small.png",
    calculations: {},
    dataValues: {},
    type: "full",
  });
}
