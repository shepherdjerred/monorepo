package com.shepherdjerred.thestorm.core.players;

import org.bukkit.entity.Player;

/** Citizens player bodies cannot satisfy human presence or receive human join rewards. */
public final class Humans {
  private Humans() {}

  public static boolean isHuman(Player player) {
    return !player.hasMetadata("NPC");
  }
}
