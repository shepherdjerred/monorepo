package com.shepherdjerred.thestorm.creative.domain;

import java.util.Set;

/**
 * Movement and block-breaking checks paused while a player is in the creative world. Grim's owned
 * config has no per-world key, so the creative module applies this set to that player's checks and
 * restores them on leave. Other worlds keep every check.
 */
public final class AnticheatExemption {

  private static final Set<String> PAUSED =
      Set.of(
          "Simulation",
          "GroundSpoof",
          "Phase",
          "FastBreak",
          "MultiBreak",
          "AirLiquidBreak",
          "FarBreak",
          "InvalidBreak",
          "NoSwingBreak",
          "PositionBreakA",
          "PositionBreakB",
          "RotationBreak",
          "WrongBreak",
          "grim.prediction.simulation",
          "grim.prediction.phase");

  private AnticheatExemption() {}

  public static boolean inCreative(String world, String creativeWorld) {
    return creativeWorld.equals(world);
  }

  /** Whether a Grim check name, config name, or stable key is paused in creative. */
  public static boolean pauses(String name) {
    if (PAUSED.contains(name)) {
      return true;
    }
    return name.startsWith("grim.breaking.");
  }
}
