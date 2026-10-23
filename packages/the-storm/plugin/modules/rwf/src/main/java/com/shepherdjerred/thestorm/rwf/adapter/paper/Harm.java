package com.shepherdjerred.thestorm.rwf.adapter.paper;

import org.bukkit.entity.LivingEntity;

/**
 * Damage the rules deal a living thing themselves, taken as vanilla takes it: absorption hearts
 * first, then health. Setting health alone let every sword and arrow hit pass straight through a
 * golden apple's absorption.
 */
final class Harm {
  private Harm() {}

  /**
   * The part of {@code damage} that reaches {@code victim}'s health past its absorption, read
   * before the hit lands: what the damage ledger, statistics and kill credit count.
   */
  static double toHealth(LivingEntity victim, double damage) {
    return Math.max(0, damage - Math.max(0, victim.getAbsorptionAmount()));
  }

  /** Takes {@code damage} from {@code victim}'s absorption, then its health. */
  static void take(LivingEntity victim, double damage) {
    var absorbed = Math.min(Math.max(0, victim.getAbsorptionAmount()), damage);
    if (absorbed > 0) victim.setAbsorptionAmount(victim.getAbsorptionAmount() - absorbed);
    victim.setHealth(Math.max(0, victim.getHealth() - (damage - absorbed)));
  }
}
