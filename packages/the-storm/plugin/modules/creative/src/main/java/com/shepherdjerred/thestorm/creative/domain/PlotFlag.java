package com.shepherdjerred.thestorm.creative.domain;

import java.util.Optional;
import java.util.Set;

/**
 * A visitor permission stored on one plot. Break and place stay with the role. These flags do not
 * change world gamerules, including leaf decay and fire spread.
 */
public enum PlotFlag {
  PVP,
  USE,
  VEHICLE,
  MOB_INTERACT,
  EXPLOSION;

  /** The value written in {@code creative_flags.flag}. */
  public String stored() {
    return switch (this) {
      case PVP -> "pvp";
      case USE -> "use";
      case VEHICLE -> "vehicle";
      case MOB_INTERACT -> "mob-interact";
      case EXPLOSION -> "explosion";
    };
  }

  /** A known flag name. An unknown name is a bad command, not a corrupt row. */
  public static Optional<PlotFlag> parse(String text) {
    return switch (text) {
      case "pvp" -> Optional.of(PVP);
      case "use" -> Optional.of(USE);
      case "vehicle" -> Optional.of(VEHICLE);
      case "mob-interact" -> Optional.of(MOB_INTERACT);
      case "explosion" -> Optional.of(EXPLOSION);
      default -> Optional.empty();
    };
  }

  /** The flag stored as {@code text}. Anything else is a corrupt row. */
  public static PlotFlag require(String text) {
    return parse(text)
        .orElseThrow(() -> new IllegalArgumentException("unknown creative flag: " + text));
  }

  /**
   * Whether a player may do {@code flag}'s action. A builder is the owner, a member, trusted, or
   * staff. Visitors need the flag on. An empty set is every flag off.
   */
  public static boolean visitorMay(boolean builder, Set<PlotFlag> enabled, PlotFlag flag) {
    return builder || enabled.contains(flag);
  }

  /**
   * An explosion that leaves its plot is refused. On a marked plot it also needs {@link
   * #EXPLOSION}. An empty cell keeps the contained-explosion rule and has no flag to turn a
   * gamerule back on.
   */
  public static boolean explosionMay(boolean contained, boolean marked, Set<PlotFlag> enabled) {
    if (!contained) {
      return false;
    }
    return !marked || enabled.contains(EXPLOSION);
  }
}
