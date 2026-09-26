package com.shepherdjerred.thestorm.quests.domain.engine;

import com.shepherdjerred.thestorm.quests.domain.model.Condition.Weather;
import com.shepherdjerred.thestorm.quests.domain.model.ItemMatch;

/**
 * What the world says about a player right now. The Paper adapter answers from the live player;
 * tests and the simulator answer from scripts.
 */
public interface Facts {

  /** How many matching items the player carries. */
  int count(ItemMatch item);

  /** The player's level in {@code track}, 0 if untrained. */
  int trackLevel(String track);

  /** The in-game time in the player's world, in minutes after midnight (06:00 is sunrise). */
  int minuteOfDay();

  /** The weather in the player's world. */
  Weather weather();

  /** Whether the player stands in {@code region}. */
  boolean inRegion(String region);

  /** Whether the player has permission {@code node}. */
  boolean hasPermission(String node);
}
