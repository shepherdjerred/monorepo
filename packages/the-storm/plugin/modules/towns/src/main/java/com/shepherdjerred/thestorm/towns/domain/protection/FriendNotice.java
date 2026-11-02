package com.shepherdjerred.thestorm.towns.domain.protection;

import com.shepherdjerred.thestorm.towns.domain.town.Town;
import java.util.UUID;

/** What an outsider and the online owner hear when a friend-shaped action is refused. */
public final class FriendNotice {

  private FriendNotice() {}

  /** Build, doors and switches, containers, and teleporting in. */
  public static boolean alerts(Action action) {
    return switch (action) {
      case BUILD, INTERACT, USE_REDSTONE, OPEN_CONTAINER, TELEPORT_INTO -> true;
      case BREAK, INTERACT_ENTITY, DAMAGE_ENTITY, PLACE_ENTITY, ATTACK_PLAYER, SET_HOME -> false;
    };
  }

  /**
   * True when {@code actor} is not a member and {@code action} is one they may need an invite for.
   */
  public static boolean shouldAlert(Town town, UUID actor, Action action) {
    return alerts(action) && town.roleOf(actor).isEmpty();
  }

  /** Told to the visitor. {@code ownerAccount} is the name {@code /camp join} accepts. */
  public static String visitor(Town town, Action action, String ownerAccount) {
    var verb = verb(action);
    if (town.isCamp()) {
      return "You can't "
          + verb
          + " in "
          + town.name()
          + "'s camp. Ask them to /camp invite you, then /camp join "
          + ownerAccount
          + ".";
    }
    return "You can't " + verb + " in " + town.name() + ". Ask them to /town invite you.";
  }

  /** Told to the owner. {@code visitor} is the name {@code /camp invite} accepts. */
  public static String owner(Town town, Action action, String visitor) {
    var verb = verb(action);
    if (town.isCamp()) {
      return visitor
          + " can't "
          + verb
          + " in your camp. Invite them with /camp invite "
          + visitor
          + ".";
    }
    return visitor
        + " can't "
        + verb
        + " in your town. Invite them with /town invite "
        + visitor
        + ".";
  }

  private static String verb(Action action) {
    return switch (action) {
      case BUILD -> "build";
      case INTERACT, INTERACT_ENTITY -> "use that";
      case USE_REDSTONE -> "change redstone";
      case OPEN_CONTAINER -> "open that";
      case TELEPORT_INTO -> "teleport";
      case BREAK -> "break things";
      case DAMAGE_ENTITY -> "hurt that";
      case PLACE_ENTITY -> "place that";
      case ATTACK_PLAYER -> "fight";
      case SET_HOME -> "set a home";
    };
  }
}
