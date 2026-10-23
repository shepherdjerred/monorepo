package com.shepherdjerred.thestorm.rwf.adapter.paper;

import org.bukkit.entity.LivingEntity;

/**
 * Damage the rules deal a living thing themselves, taken as vanilla takes it: absorption hearts
 * first, then health. Setting health alone let every sword and arrow hit pass straight through a
 * golden apple's absorption.
 */
final class Harm {
  private Harm() {}

  /** Takes {@code damage} from {@code victim}'s absorption, then its health. */
  static void take(LivingEntity victim, double damage) {
    var absorbed = Math.min(Math.max(0, victim.getAbsorptionAmount()), damage);
    if (absorbed > 0) victim.setAbsorptionAmount(victim.getAbsorptionAmount() - absorbed);
    victim.setHealth(Math.max(0, victim.getHealth() - (damage - absorbed)));
  }
}
