package com.shepherdjerred.thestorm.arena.app.store;

import java.time.Instant;
import java.util.List;
import java.util.OptionalInt;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;

/** Each player's furthest wave per arena. */
public interface LeaderboardStore {

  /** Records a result, keeping the player's best (the earliest time wins a tie). */
  CompletableFuture<Void> record(Result result);

  /** The best players of {@code arena}, furthest wave first, earliest first on a tie. */
  CompletableFuture<List<Standing>> top(String arena, int limit);

  /** {@code player}'s best wave in {@code arena}, if they have played it. */
  CompletableFuture<OptionalInt> best(UUID player, String arena);

  /**
   * How far a player got in one game.
   *
   * @param player the player
   * @param name their name at the time
   * @param arena the arena
   * @param wave the wave they reached
   * @param at when
   */
  record Result(UUID player, String name, String arena, int wave, Instant at) {}

  /**
   * One row of {@link #top}.
   *
   * @param name the player's name when they set it
   * @param wave their best wave
   */
  record Standing(String name, int wave) {}
}
