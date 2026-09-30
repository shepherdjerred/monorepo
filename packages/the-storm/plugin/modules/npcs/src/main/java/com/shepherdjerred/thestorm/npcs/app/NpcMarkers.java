package com.shepherdjerred.thestorm.npcs.app;

import org.bukkit.entity.Player;

/**
 * Quest markers ({@code !} and {@code ?}) floating above NPCs, each seen only by the player it is
 * set for. Markers last until the player quits, so set them again when a player joins. Main thread.
 */
public interface NpcMarkers {

  /**
   * Shows {@code marker} above NPC {@code npc} to {@code player} only; {@link QuestMarker#NONE}
   * removes it.
   *
   * @throws IllegalArgumentException if no NPC has id {@code npc}
   */
  void set(Player player, String npc, QuestMarker marker);
}
