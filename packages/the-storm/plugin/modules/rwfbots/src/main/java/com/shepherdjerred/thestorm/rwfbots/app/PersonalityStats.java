package com.shepherdjerred.thestorm.rwfbots.app;

import com.shepherdjerred.thestorm.rwfbots.domain.director.Rating;
import java.time.Instant;

/**
 * A personality's record across matches: how it has done and where it sits on the shared ladder.
 *
 * @param personalityId which personality
 * @param matches matches played to a result
 * @param wins matches won
 * @param kills kills
 * @param deaths deaths
 * @param plants bombs it helped arm
 * @param defuses bombs it helped defuse
 * @param rating its OpenSkill rating
 * @param lastSeen when it last played
 */
public record PersonalityStats(
    String personalityId,
    int matches,
    int wins,
    int kills,
    int deaths,
    int plants,
    int defuses,
    Rating rating,
    Instant lastSeen) {

  public PersonalityStats {
    if (personalityId.isBlank()) {
      throw new IllegalArgumentException("personality id must not be blank");
    }
    if (matches < 0 || wins < 0 || kills < 0 || deaths < 0 || plants < 0 || defuses < 0) {
      throw new IllegalArgumentException("counts must not be negative");
    }
    if (wins > matches) {
      throw new IllegalArgumentException("wins cannot exceed matches");
    }
  }

  /** A personality's record before its first match, rated {@code rating}. */
  public static PersonalityStats fresh(String personalityId, Rating rating, Instant now) {
    return new PersonalityStats(personalityId, 0, 0, 0, 0, 0, 0, rating, now);
  }

  /**
   * One match's tally for a bot.
   *
   * @param kills kills
   * @param deaths deaths
   * @param plants bombs it helped arm
   * @param defuses bombs it helped defuse
   */
  public record Tally(int kills, int deaths, int plants, int defuses) {

    public static final Tally NONE = new Tally(0, 0, 0, 0);

    public Tally {
      if (kills < 0 || deaths < 0 || plants < 0 || defuses < 0) {
        throw new IllegalArgumentException("tally counts must not be negative");
      }
    }

    public Tally kill() {
      return new Tally(kills + 1, deaths, plants, defuses);
    }

    public Tally death() {
      return new Tally(kills, deaths + 1, plants, defuses);
    }

    public Tally plant() {
      return new Tally(kills, deaths, plants + 1, defuses);
    }

    public Tally defuse() {
      return new Tally(kills, deaths, plants, defuses + 1);
    }
  }

  /** This record after a match that {@code won} or not, with {@code tally} and a new rating. */
  public PersonalityStats afterMatch(boolean won, Tally tally, Rating newRating, Instant now) {
    return new PersonalityStats(
        personalityId,
        matches + 1,
        wins + (won ? 1 : 0),
        kills + tally.kills(),
        deaths + tally.deaths(),
        plants + tally.plants(),
        defuses + tally.defuses(),
        newRating,
        now);
  }
}
