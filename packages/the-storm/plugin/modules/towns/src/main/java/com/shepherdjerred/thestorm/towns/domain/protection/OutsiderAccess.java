package com.shepherdjerred.thestorm.towns.domain.protection;

import com.shepherdjerred.thestorm.towns.domain.land.ClaimFlag;
import com.shepherdjerred.thestorm.towns.domain.land.ClaimFlags;

/**
 * What opens each action to outsiders on a town's claim. Lockable block containers are decided by
 * their lock first (see the lock domain): an unlocked one someone placed is anyone's to open,
 * wherever it stands; everything else that holds items (carts, chest boats, composters, a chest
 * nobody placed) follows this table.
 */
public final class OutsiderAccess {

  private OutsiderAccess() {}

  /** How outsiders get to do an action on a claim. */
  public sealed interface Opening {

    /** Open while the claim has {@code flag} on. */
    record ByFlag(ClaimFlag flag) implements Opening {}

    /** Never open: outsiders may not teleport into a town or set a home in it. */
    record Never() implements Opening {}
  }

  /**
   * What opens {@code action} to outsiders. Opening a container follows building: whoever may break
   * a container may as well open it.
   */
  public static Opening opening(Action action) {
    return switch (action) {
      case BUILD, BREAK, PLACE_ENTITY, OPEN_CONTAINER -> new Opening.ByFlag(ClaimFlag.PUBLIC_BUILD);
      case INTERACT, USE_REDSTONE -> new Opening.ByFlag(ClaimFlag.PUBLIC_SWITCHES);
      case DAMAGE_ENTITY, INTERACT_ENTITY -> new Opening.ByFlag(ClaimFlag.PUBLIC_ENTITIES);
      case ATTACK_PLAYER -> new Opening.ByFlag(ClaimFlag.PVP);
      case TELEPORT_INTO, SET_HOME -> new Opening.Never();
    };
  }

  /** True when a claim with {@code flags} lets outsiders do {@code action}. */
  public static boolean opens(Action action, ClaimFlags flags) {
    return switch (opening(action)) {
      case Opening.ByFlag(var flag) -> flags.has(flag);
      case Opening.Never _ -> false;
    };
  }
}
