// Ported from libraryaddict's Red Warfare
// (redwarfare-global/src/me/libraryaddict/core/ServerType.java, SearchAndDestroy,
// and redwarfare-arcade/src/me/libraryaddict/arcade/managers/LobbyManager.java); see
// packages/the-storm/NOTICE.
package com.shepherdjerred.thestorm.rwf.domain.match;

import java.time.Duration;

/**
 * Everything fixed about how matches run.
 *
 * @param minPlayers players wanted before the countdown starts
 * @param absoluteMinPlayers the fewest the requirement relaxes to while the lobby waits
 * @param maxPlayers the most players in a match
 * @param countdown from enough players to going live
 * @param relaxEvery every this long of waiting takes one off the player requirement
 * @param endLinger how long the end screen lasts before the arena resets
 * @param minimumRewardLength matches shorter than this pay nobody
 */
public record MatchSettings(
    int minPlayers,
    int absoluteMinPlayers,
    int maxPlayers,
    Duration countdown,
    Duration relaxEvery,
    Duration endLinger,
    Duration minimumRewardLength) {

  /** Red Warfare's Search and Destroy server: 4 wanted, 2 at least, 60 at most, 90 s countdown. */
  public static final MatchSettings RED_WARFARE =
      new MatchSettings(
          4,
          2,
          60,
          Duration.ofSeconds(90),
          Duration.ofSeconds(15),
          Duration.ofSeconds(15),
          Duration.ofMinutes(1));

  public MatchSettings {
    if (absoluteMinPlayers < 1 || minPlayers < absoluteMinPlayers || maxPlayers < minPlayers) {
      throw new IllegalArgumentException("need 1 <= absoluteMin <= min <= max players");
    }
    if (countdown.isNegative()
        || countdown.isZero()
        || relaxEvery.isNegative()
        || relaxEvery.isZero()
        || endLinger.isNegative()
        || minimumRewardLength.isNegative()) {
      throw new IllegalArgumentException("durations must be positive");
    }
  }

  /** How many players a lobby that has waited {@code waited} needs before counting down. */
  public int requiredPlayers(Duration waited) {
    var relaxed = waited.isNegative() ? 0 : waited.dividedBy(relaxEvery);
    return (int) Math.max(absoluteMinPlayers, minPlayers - relaxed);
  }

  public MatchSettings withMaxPlayers(int newMax) {
    return new MatchSettings(
        minPlayers,
        absoluteMinPlayers,
        newMax,
        countdown,
        relaxEvery,
        endLinger,
        minimumRewardLength);
  }
}
