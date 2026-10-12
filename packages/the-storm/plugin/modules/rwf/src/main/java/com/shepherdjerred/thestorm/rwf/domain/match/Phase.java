// Ported from libraryaddict's Red Warfare
// (redwarfare-arcade/src/me/libraryaddict/arcade/managers/GameState.java);
// see packages/the-storm/NOTICE.
package com.shepherdjerred.thestorm.rwf.domain.match;

import com.shepherdjerred.thestorm.rwf.domain.combatant.TeamColor;
import com.shepherdjerred.thestorm.rwf.domain.poison.PoisonClock;
import java.time.Instant;
import java.util.Optional;
import java.util.Set;

/** Where a match is: lobby, countdown, live, ended, resetting, and round again. */
public sealed interface Phase {

  default boolean live() {
    return this instanceof Live;
  }

  /** Whether players may join and pick kits. */
  default boolean preGame() {
    return this instanceof Lobby || this instanceof Countdown;
  }

  /**
   * Waiting for players.
   *
   * @param waitingSince when the first player arrived; the player requirement relaxes from here
   */
  record Lobby(Optional<Instant> waitingSince) implements Phase {

    public static final Lobby EMPTY = new Lobby(Optional.empty());
  }

  /**
   * Enough players and a map; the match goes live at {@code startsAt}.
   *
   * @param startsAt when
   * @param waitingSince when the lobby started waiting, kept so the requirement keeps relaxing
   * @param lastAnnounced the seconds-left figure last announced, so each is announced once
   */
  record Countdown(Instant startsAt, Instant waitingSince, int lastAnnounced) implements Phase {}

  /**
   * Fighting.
   *
   * @param startedAt when the match went live
   * @param poison the end-of-game poison
   * @param nextPoisonSecond when the poison next ticks (it runs once a second whatever the tick
   *     rate)
   * @param lastManAnnounced teams whose last living member has been given Bomb Arming X
   * @param defeated teams eliminated so far
   */
  record Live(
      Instant startedAt,
      PoisonClock poison,
      Instant nextPoisonSecond,
      Set<TeamColor> lastManAnnounced,
      Set<TeamColor> defeated)
      implements Phase {

    public Live {
      lastManAnnounced = Set.copyOf(lastManAnnounced);
      defeated = Set.copyOf(defeated);
    }
  }

  /**
   * Over; the result is shown until the arena resets.
   *
   * @param at when it ended
   * @param outcome who won
   */
  record Ended(Instant at, Outcome outcome) implements Phase {}

  /** Everyone has been restored; the adapter is reverting craters and clearing the map. */
  record Resetting() implements Phase {}
}
