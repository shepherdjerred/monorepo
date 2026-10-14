package com.shepherdjerred.thestorm.rwf.adapter.paper;

import com.shepherdjerred.thestorm.rwf.domain.combat.AttackType;
import com.shepherdjerred.thestorm.rwf.domain.combat.PotionMitigation;
import org.bukkit.entity.Player;
import org.bukkit.potion.PotionEffectType;

/** Custom damage replaces vanilla modifiers, so it must explicitly retain Resistance. */
final class PaperKitResistance {
  private PaperKitResistance() {}

  static double apply(Player victim, double damage, AttackType type) {
    var resistance = victim.getPotionEffect(PotionEffectType.RESISTANCE);
    return PotionMitigation.resistance(
        damage, resistance == null ? -1 : resistance.getAmplifier(), type);
  }
}
