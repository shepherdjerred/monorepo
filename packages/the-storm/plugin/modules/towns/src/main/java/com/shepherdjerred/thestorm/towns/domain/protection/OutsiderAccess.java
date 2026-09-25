package com.shepherdjerred.thestorm.towns.domain.protection;

import com.shepherdjerred.thestorm.towns.domain.land.ClaimFlag;
import java.util.Optional;

/** Which claim flag opens each action to outsiders. */
public final class OutsiderAccess {

  private OutsiderAccess() {}

  /**
   * The flag that lets outsiders do {@code action} on a claim, or empty when no flag does:
   * outsiders may never teleport into a town or set a home in it.
   */
  public static Optional<ClaimFlag> flagFor(Action action) {
    return switch (action) {
      case BUILD, BREAK, PLACE_ENTITY -> Optional.of(ClaimFlag.PUBLIC_BUILD);
      case OPEN_CONTAINER -> Optional.of(ClaimFlag.PUBLIC_CONTAINERS);
      case INTERACT, USE_REDSTONE -> Optional.of(ClaimFlag.PUBLIC_SWITCHES);
      case DAMAGE_ENTITY, INTERACT_ENTITY -> Optional.of(ClaimFlag.PUBLIC_ENTITIES);
      case ATTACK_PLAYER -> Optional.of(ClaimFlag.PVP);
      case TELEPORT_INTO, SET_HOME -> Optional.empty();
    };
  }
}
