package com.shepherdjerred.thestorm.quests.domain.engine;

import java.util.Collection;
import java.util.Set;

/** Rejects kills of creatures created for farming, commands, arenas, or quests. */
public final class KillCredit {

  /** Scoreboard tag on creatures this quest module spawned. */
  public static final String QUEST_SPAWNED = "thestorm:quest_spawned";

  /** Scoreboard tag on arena creatures. */
  public static final String ARENA_ENTITY = "thestorm:arena_entity";

  private static final Set<String> FARMED_SPAWNS =
      Set.of("SPAWNER", "TRIAL_SPAWNER", "SPAWNER_EGG", "DISPENSE_EGG", "COMMAND", "CUSTOM");

  private KillCredit() {}

  /** Whether a creature with this original spawn reason and these tags counts for a kill quest. */
  public static boolean eligible(String reason, Collection<String> tags) {
    return !FARMED_SPAWNS.contains(reason)
        && !tags.contains(QUEST_SPAWNED)
        && !tags.contains(ARENA_ENTITY);
  }
}
