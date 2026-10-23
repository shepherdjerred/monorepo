package com.shepherdjerred.thestorm.creative.domain;

import java.util.Map;
import java.util.UUID;

/**
 * A player's role on one plot, stored in {@code creative_trust.role}. There are no named groups.
 * The owner is the claim row, not a role.
 */
public enum PlotRole {
  MEMBER,
  TRUSTED,
  DENIED;

  /** Members and trusted players may build. Denied players may not. */
  public boolean builds() {
    return this == MEMBER || this == TRUSTED;
  }

  /** The value written in {@code creative_trust.role}. */
  public String stored() {
    return switch (this) {
      case MEMBER -> "member";
      case TRUSTED -> "trusted";
      case DENIED -> "denied";
    };
  }

  /** The role stored as {@code text}. Anything else is a corrupt row. */
  public static PlotRole parse(String text) {
    return switch (text) {
      case "member" -> MEMBER;
      case "trusted" -> TRUSTED;
      case "denied" -> DENIED;
      default -> throw new IllegalArgumentException("unknown creative role: " + text);
    };
  }

  /** Whether {@code actor} may break and place. The owner is decided by the caller. */
  public static boolean builds(Map<UUID, PlotRole> access, UUID actor) {
    var role = access.get(actor);
    return role != null && role.builds();
  }

  /** Staff may enter. A denied player may not. Everyone else may. */
  public static boolean mayEnter(boolean staff, Map<UUID, PlotRole> access, UUID actor) {
    return staff || access.get(actor) != DENIED;
  }
}
