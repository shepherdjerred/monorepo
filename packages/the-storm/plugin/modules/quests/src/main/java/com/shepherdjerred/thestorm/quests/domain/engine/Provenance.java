package com.shepherdjerred.thestorm.quests.domain.engine;

import java.time.Duration;
import java.time.Instant;
import java.util.Collection;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * Where things came from, so objectives only count honest play: kills of creatures that spawned
 * naturally, pickups of items nobody dropped, crafts that are not a compress/uncompress round trip,
 * and party credit only for partners who are actually playing.
 */
public final class Provenance {

  /** Spawn reasons whose creatures never count for kill objectives. */
  public static final Set<String> FARMED_SPAWNS =
      Set.of("SPAWNER", "TRIAL_SPAWNER", "SPAWNER_EGG", "COMMAND", "CUSTOM");

  /** Entity tag for creatures a quest spawned. */
  public static final String QUEST_SPAWNED = "thestorm:quest_spawned";

  /** Entity tag for arena creatures (set by the arena module). */
  public static final String ARENA_ENTITY = "thestorm:arena_entity";

  /** Item tag for items a player dropped. */
  public static final String DROPPED = "thestorm:dropped";

  private final Map<UUID, Instant> lastActive = new HashMap<>();

  /** Whether killing a creature that spawned for {@code reason} with {@code tags} counts. */
  public static boolean killCounts(String reason, Collection<String> tags) {
    return !FARMED_SPAWNS.contains(reason)
        && !tags.contains(QUEST_SPAWNED)
        && !tags.contains(ARENA_ENTITY);
  }

  /**
   * How many items of a pickup count: what actually went into the inventory, and nothing if the
   * item was thrown or dropped by anyone.
   */
  public static int pickupCounts(int stackAmount, int remaining, boolean thrown) {
    return thrown ? 0 : Math.max(0, stackAmount - remaining);
  }

  /**
   * Whether a recipe just compresses or uncompresses one material (nine ingots into a block, a
   * block back into nine ingots, four into one), which could be repeated forever.
   *
   * @param ingredients each non-empty crafting slot's material
   * @param resultAmount how many results one craft makes
   */
  public static boolean reversible(List<String> ingredients, int resultAmount) {
    var distinct = Set.copyOf(ingredients);
    if (distinct.size() != 1) {
      return false;
    }
    var slots = ingredients.size();
    return ((slots == 4 || slots == 9) && resultAmount == 1)
        || (slots == 1 && (resultAmount == 4 || resultAmount == 9));
  }

  /** {@code player} moved or acted at {@code now}. */
  public void acted(UUID player, Instant now) {
    lastActive.put(player, now);
  }

  /** Whether {@code player} acted within {@code window} before {@code now}. */
  public boolean active(UUID player, Instant now, Duration window) {
    var last = lastActive.get(player);
    return last != null && !last.plus(window).isBefore(now);
  }

  /** Forgets {@code player} (they quit). */
  public void forget(UUID player) {
    lastActive.remove(player);
  }
}
