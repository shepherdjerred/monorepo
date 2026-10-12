package com.shepherdjerred.thestorm.rwf.app.store;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.OptionalDouble;
import java.util.UUID;

/**
 * How a finished match was played, written with its match row and players in one transaction: the
 * match's details, each human's line, the event log, and from those each human's lifetime totals.
 *
 * @param details the match's seed, length, end and vote
 * @param players one line per human who played
 * @param events what happened, in order
 */
public record MatchStats(Details details, List<PlayerLine> players, List<EventRow> events) {

  public MatchStats {
    players = List.copyOf(players);
    events = List.copyOf(events);
    for (var i = 0; i < events.size(); i++) {
      if (events.get(i).seq() != i) {
        throw new IllegalArgumentException("events are numbered from 0 in order");
      }
    }
  }

  /**
   * A match's details.
   *
   * @param seed its randomness
   * @param duration how long it was live
   * @param endReason {@code LAST_TEAM_STANDING}, {@code DRAW} or {@code STOPPED}
   * @param ballot the vote as JSON, if one was held
   * @param mapHash the map's blocks hash
   */
  public record Details(
      long seed, Duration duration, String endReason, Optional<String> ballot, String mapHash) {

    public Details {
      if (duration.isNegative()) {
        throw new IllegalArgumentException("a match lasts no negative time");
      }
    }
  }

  /** How a player's match ended, for wins and losses. */
  public enum Result {
    WIN,
    LOSS,
    /** Stopped, or left: neither a win nor a loss. */
    NONE,
  }

  /**
   * One human's match.
   *
   * @param player who
   * @param name their name now, for leaderboards
   * @param kit the kit they played
   * @param result how it ended for them
   * @param kills kills credited
   * @param assists assists credited
   * @param deaths deaths (0 or 1)
   * @param suicide whether they died by their own hand or quit
   * @param streak whole killstreak steps reached
   * @param damageDealt damage dealt to other combatants
   * @param damageTaken damage taken
   * @param arms bombs they helped arm
   * @param defuses bombs they helped defuse
   * @param explosions bombs they helped arm that went off
   * @param abilityUses kit abilities used
   * @param shotsFired arrows loosed
   * @param shotsHit arrows that hit a combatant
   * @param steaks steaks eaten
   * @param timeAlive time alive in the live match
   * @param distance blocks moved while alive in the live match
   * @param kitSwitches kit changes before the teams were dealt
   */
  public record PlayerLine(
      UUID player,
      String name,
      String kit,
      Result result,
      int kills,
      int assists,
      int deaths,
      boolean suicide,
      int streak,
      double damageDealt,
      double damageTaken,
      int arms,
      int defuses,
      int explosions,
      int abilityUses,
      int shotsFired,
      int shotsHit,
      int steaks,
      Duration timeAlive,
      double distance,
      int kitSwitches) {

    public PlayerLine {
      if (kills < 0
          || assists < 0
          || deaths < 0
          || streak < 0
          || arms < 0
          || defuses < 0
          || explosions < 0
          || abilityUses < 0
          || shotsFired < 0
          || shotsHit < 0
          || steaks < 0
          || kitSwitches < 0
          || damageDealt < 0
          || damageTaken < 0
          || distance < 0
          || timeAlive.isNegative()) {
        throw new IllegalArgumentException("match statistics are never negative");
      }
    }
  }

  /**
   * One entry in the match's event log.
   *
   * @param seq its place, from 0
   * @param at when
   * @param kind such as {@code kill}, {@code death}, {@code arm}, {@code defuse}, {@code
   *     explosion}, {@code ballot}
   * @param actor who did it, if a player
   * @param target who or what it was done to (a player's UUID or a bomb id)
   * @param kit the actor's kit
   * @param cause the attack type, for deaths
   * @param x where, if known
   * @param y where, if known
   * @param z where, if known
   * @param data a JSON object with anything else
   */
  public record EventRow(
      int seq,
      Instant at,
      String kind,
      Optional<UUID> actor,
      Optional<String> target,
      Optional<String> kit,
      Optional<String> cause,
      OptionalDouble x,
      OptionalDouble y,
      OptionalDouble z,
      String data) {

    public EventRow {
      if (kind.isBlank() || data.isBlank()) {
        throw new IllegalArgumentException("an event has a kind and a JSON object");
      }
    }
  }
}
