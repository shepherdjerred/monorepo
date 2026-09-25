package com.shepherdjerred.thestorm.arena.domain.game;

import com.shepherdjerred.thestorm.arena.domain.wave.SpawnUnit;
import java.time.Instant;
import java.util.List;

/** Where a game is. */
public sealed interface Phase {

  /** Whether waves are under way. */
  default boolean running() {
    return this instanceof Intermission || this instanceof Fighting;
  }

  /** Waiting for players; empty when nobody is in the arena. */
  record Lobby() implements Phase {}

  /**
   * Everyone is ready; the gates open at {@code startsAt}.
   *
   * @param startsAt when the game starts
   */
  record Countdown(Instant startsAt) implements Phase {}

  /**
   * Between waves.
   *
   * @param nextWave the wave that comes next
   * @param at when it comes
   */
  record Intermission(int nextWave, Instant at) implements Phase {}

  /**
   * A wave is under way.
   *
   * @param wave the wave number
   * @param queue mobs still to spawn, waiting for room under the entity cap
   * @param startedAt when the wave started, for its timeout
   */
  record Fighting(int wave, List<SpawnUnit> queue, Instant startedAt) implements Phase {

    public Fighting {
      queue = List.copyOf(queue);
    }
  }
}
