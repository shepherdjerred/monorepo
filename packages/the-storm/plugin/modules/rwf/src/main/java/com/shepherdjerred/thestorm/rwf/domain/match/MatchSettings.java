// Ported from libraryaddict's Red Warfare
// (redwarfare-global/src/me/libraryaddict/core/ServerType.java, SearchAndDestroy,
// and redwarfare-arcade/src/me/libraryaddict/arcade/managers/LobbyManager.java); see
// packages/the-storm/NOTICE.
package com.shepherdjerred.thestorm.rwf.domain.match;

import com.shepherdjerred.thestorm.rwf.domain.kit.KitPool;
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
 * @param voteLead how long before the countdown ends the map vote closes, so the chosen map can
 *     load while it finishes
 * @param previewLength how long members fly over the chosen map before the teams are dealt; zero
 *     skips the preview
 * @param freezeLength how long everyone stands still at their spawn before the fight; zero skips
 *     the freeze
 * @param carryOver whether humans stay in for the next match when one ends on its own (bots, and
 *     everyone after a stop, are always released)
 */
public record MatchSettings(
    int minPlayers,
    int absoluteMinPlayers,
    int maxPlayers,
    Duration countdown,
    Duration relaxEvery,
    Duration endLinger,
    Duration minimumRewardLength,
    Duration voteLead,
    Duration previewLength,
    Duration freezeLength,
    boolean carryOver,
    KitPool kitPool) {

  /** Red Warfare's Search and Destroy server: 4 wanted, 2 at least, 60 at most, 90 s countdown. */
  public static final MatchSettings RED_WARFARE =
      new MatchSettings(
          4,
          2,
          60,
          Duration.ofSeconds(90),
          Duration.ofSeconds(15),
          Duration.ofSeconds(15),
          Duration.ofMinutes(1),
          Duration.ofSeconds(20),
          Duration.ofSeconds(10),
          Duration.ofSeconds(5),
          true,
          KitPool.ALL);

  public MatchSettings {
    java.util.Objects.requireNonNull(kitPool);
    if (absoluteMinPlayers < 1 || minPlayers < absoluteMinPlayers || maxPlayers < minPlayers) {
      throw new IllegalArgumentException("need 1 <= absoluteMin <= min <= max players");
    }
    if (countdown.isNegative()
        || countdown.isZero()
        || relaxEvery.isNegative()
        || relaxEvery.isZero()
        || endLinger.isNegative()
        || minimumRewardLength.isNegative()
        || voteLead.isNegative()
        || previewLength.isNegative()
        || freezeLength.isNegative()) {
      throw new IllegalArgumentException("durations must be positive");
    }
  }

  /** How many players a lobby that has waited {@code waited} needs before counting down. */
  public int requiredPlayers(Duration waited) {
    var relaxed = waited.isNegative() ? 0 : waited.dividedBy(relaxEvery);
    return (int) Math.max(absoluteMinPlayers, minPlayers - relaxed);
  }

  /** Candidate visits already granted the voting period; only the map-loading lead remains. */
  public Duration countdownAfter(Ballot ballot) {
    return ballot.visits().isPresent() ? voteLead : countdown;
  }

  public MatchSettings withMaxPlayers(int newMax) {
    return new MatchSettings(
        minPlayers,
        absoluteMinPlayers,
        newMax,
        countdown,
        relaxEvery,
        endLinger,
        minimumRewardLength,
        voteLead,
        previewLength,
        freezeLength,
        carryOver,
        kitPool);
  }

  /** These settings with a different preview, freeze and carry-over, as the flags decide. */
  public MatchSettings withFlow(
      Duration newVoteLead, Duration newPreview, Duration newFreeze, boolean newCarryOver) {
    return new MatchSettings(
        minPlayers,
        absoluteMinPlayers,
        maxPlayers,
        countdown,
        relaxEvery,
        endLinger,
        minimumRewardLength,
        newVoteLead,
        newPreview,
        newFreeze,
        newCarryOver,
        kitPool);
  }

  public MatchSettings withKitPool(KitPool pool) {
    return new MatchSettings(
        minPlayers,
        absoluteMinPlayers,
        maxPlayers,
        countdown,
        relaxEvery,
        endLinger,
        minimumRewardLength,
        voteLead,
        previewLength,
        freezeLength,
        carryOver,
        pool);
  }
}
