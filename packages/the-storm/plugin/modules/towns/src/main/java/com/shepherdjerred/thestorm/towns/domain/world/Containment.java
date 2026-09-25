package com.shepherdjerred.thestorm.towns.domain.world;

import com.shepherdjerred.thestorm.towns.domain.land.ClaimFlag;
import java.util.Optional;

/** Which claim flag, if any, lets an effect happen inside one owner's land. */
final class Containment {

  private Containment() {}

  /**
   * The flag that must be on for {@code effect} to change a claim when it starts on the same land,
   * or empty when the effect is always allowed within one owner's land.
   */
  static Optional<ClaimFlag> flagFor(WorldEffect effect) {
    return switch (effect) {
      case EXPLOSION -> Optional.of(ClaimFlag.EXPLOSIONS);
      case FIRE_SPREAD, FIRE_BURN -> Optional.of(ClaimFlag.FIRE_SPREAD);
      case MOB_GRIEF -> Optional.of(ClaimFlag.MOB_GRIEFING);
      case PISTON,
          FLUID_FLOW,
          ITEM_TRANSFER,
          DISPENSE,
          TREE_GROWTH,
          BONEMEAL_SPREAD,
          SCULK_SPREAD,
          BLOCK_SPREAD,
          FALLING_BLOCK,
          PROJECTILE_IMPACT,
          REDSTONE,
          PORTAL_CREATION ->
          Optional.empty();
    };
  }

  /**
   * True when the effect also takes from where it starts, so starting on protected land and
   * reaching someone else's is refused even when that is wilderness: a hopper in the wild must not
   * drain a town's chest, and a town's dropper fired from outside must not throw its items over the
   * border.
   */
  static boolean takesFromSource(WorldEffect effect) {
    return switch (effect) {
      case ITEM_TRANSFER, DISPENSE -> true;
      case PISTON,
          FLUID_FLOW,
          TREE_GROWTH,
          BONEMEAL_SPREAD,
          SCULK_SPREAD,
          BLOCK_SPREAD,
          EXPLOSION,
          FIRE_SPREAD,
          FIRE_BURN,
          MOB_GRIEF,
          FALLING_BLOCK,
          PROJECTILE_IMPACT,
          REDSTONE,
          PORTAL_CREATION ->
          false;
    };
  }
}
