package com.shepherdjerred.thestorm.towns.domain.world;

import com.shepherdjerred.thestorm.towns.domain.land.ClaimFlag;
import java.util.Map;
import java.util.Optional;

/** Which claim flag, if any, lets an effect happen inside one owner's land. */
final class Containment {

  private Containment() {}

  /**
   * The flag that must be on for {@code effect} to change a claim when it starts on the same land,
   * or empty when the effect is always allowed within one owner's land.
   */
  static Optional<ClaimFlag> flagFor(WorldEffect effect) {
    return Optional.ofNullable(FLAGS.get(effect));
  }

  private static final Map<WorldEffect, ClaimFlag> FLAGS =
      Map.of(
          WorldEffect.EXPLOSION, ClaimFlag.EXPLOSIONS,
          WorldEffect.FIRE_SPREAD, ClaimFlag.FIRE_SPREAD,
          WorldEffect.FIRE_BURN, ClaimFlag.FIRE_SPREAD,
          WorldEffect.MOB_GRIEF, ClaimFlag.MOB_GRIEFING,
          WorldEffect.GRAZING, ClaimFlag.MOB_GRIEFING);

  /**
   * True when the effect also takes from where it starts, so starting on protected land and
   * reaching someone else's is refused even when that is wilderness: a hopper in the wild must not
   * drain a town's chest, and a town's dropper fired from outside must not throw its items over the
   * border.
   */
  static boolean takesFromSource(WorldEffect effect) {
    return effect == WorldEffect.ITEM_TRANSFER || effect == WorldEffect.DISPENSE;
  }
}
