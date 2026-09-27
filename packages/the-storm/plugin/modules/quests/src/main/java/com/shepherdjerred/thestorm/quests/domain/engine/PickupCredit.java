package com.shepherdjerred.thestorm.quests.domain.engine;

/** Counts only newly acquired items, excluding anything a player has dropped. */
public final class PickupCredit {

  /** Scoreboard tag carried by items a player dropped. */
  public static final String PLAYER_DROPPED = "thestorm:player_dropped";

  private PickupCredit() {}

  /** Items actually entering the inventory from this pickup. */
  public static int amount(int stackAmount, int remaining, boolean playerDropped) {
    return playerDropped ? 0 : Math.max(0, stackAmount - remaining);
  }
}
