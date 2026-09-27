package com.shepherdjerred.thestorm.quests.app;

import org.bukkit.entity.Player;

/**
 * Read-only quest standing for other modules (barks, the town crier, gated shops). Answers from
 * memory for online players; an offline or still-loading player reads as having done nothing. Main
 * thread.
 */
public interface QuestProgress {

  /** Whether {@code player} has completed {@code quest} at least once. */
  boolean completed(Player player, String quest);

  /** Whether {@code player} has {@code quest} active. */
  boolean active(Player player, String quest);

  /** Quest variable {@code name} (0 if never set). */
  long variable(Player player, String name);

  /** Reputation with {@code faction}. */
  long reputation(Player player, String faction);

  /** Quest points. */
  long points(Player player);
}
