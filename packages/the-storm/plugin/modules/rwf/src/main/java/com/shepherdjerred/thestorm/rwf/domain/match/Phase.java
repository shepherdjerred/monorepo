// Ported from libraryaddict's Red Warfare
// (redwarfare-arcade/src/me/libraryaddict/arcade/managers/GameState.java);
// see packages/the-storm/NOTICE.
package com.shepherdjerred.thestorm.rwf.domain.match;

import com.shepherdjerred.thestorm.rwf.domain.combatant.TeamColor;
import com.shepherdjerred.thestorm.rwf.domain.poison.PoisonClock;
import java.time.Instant;
import java.util.Optional;
import java.util.Set;

/**
 * Where a match is: lobby and countdown (with the map vote), preparing the chosen map, previewing
 * it, frozen at the spawns, live, ended, resetting, and round again.
 */
public sealed interface Phase {

  default boolean live() {
    return this instanceof Live;
  }

  /** Whether players may join as members; from the freeze on they watch and join the next match. */
  default boolean admits() {
    return this instanceof Lobby
        || this instanceof Countdown
        || this instanceof Preparing
        || this instanceof Preview;
  }

  /** Whether members may still pick a kit. */
  default boolean kitsOpen() {
    return admits();
  }

  /** Whether teams have been dealt: the freeze, the fight and its result. */
  default boolean started() {
    return this instanceof Freeze || this instanceof Live || this instanceof Ended;
  }

  /** The map vote, while the lobby and the countdown run. */
  default Optional<Ballot> vote() {
    return switch (this) {
      case Lobby lobby -> Optional.of(lobby.ballot());
      case Countdown countdown -> Optional.of(countdown.ballot());
      case Preparing preparing -> Optional.of(preparing.ballot());
      default -> Optional.empty();
    };
  }

  /**
   * Waiting for players.
   *
   * @param waitingSince when the first player arrived; the player requirement relaxes from here
   * @param ballot the map vote
   */
  record Lobby(Optional<Instant> waitingSince, Ballot ballot) implements Phase {

    public static final Lobby EMPTY = new Lobby(Optional.empty(), Ballot.NONE);
  }

  /**
   * Enough players and a ballot; the vote closes {@code voteLead} before {@code startsAt}, and the
   * chosen map is previewed from then.
   *
   * @param startsAt when the countdown ends
   * @param waitingSince when the lobby started waiting, kept so the requirement keeps relaxing
   * @param lastAnnounced the seconds-left figure last announced, so each is announced once
   * @param ballot the map vote
   */
  record Countdown(Instant startsAt, Instant waitingSince, int lastAnnounced, Ballot ballot)
      implements Phase {}

  /**
   * The countdown ended before the chosen map was ready: waiting for it to load.
   *
   * @param ballot the closed vote, naming the chosen map
   * @param since when the wait began
   * @param forced whether an operator started the match, skipping preview and freeze
   */
  record Preparing(Ballot ballot, Instant since, boolean forced) implements Phase {

    public Preparing {
      if (!ballot.closed()) {
        throw new IllegalArgumentException("a match prepares only a chosen map");
      }
    }

    /** The chosen map. */
    public String mapId() {
      return ballot.chosen().orElseThrow();
    }
  }

  /**
   * Members fly over the chosen map in adventure mode, unhurt, and may still change kit.
   *
   * @param until when the teams are dealt and everyone freezes at their spawn
   */
  record Preview(Instant until) implements Phase {}

  /**
   * Teams, kits and spawns are dealt and everyone stands still at their spawn.
   *
   * @param until when the match goes live
   */
  record Freeze(Instant until) implements Phase {}

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

  /**
   * The adapter is reverting craters and clearing the map. Members carried into the next match are
   * already back in the lobby.
   */
  record Resetting() implements Phase {}
}
