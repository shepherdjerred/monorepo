package com.shepherdjerred.thestorm.tracks.domain.purchase;

import com.shepherdjerred.thestorm.tracks.app.PurchaseProblem;
import com.shepherdjerred.thestorm.tracks.app.Quote;
import com.shepherdjerred.thestorm.tracks.app.Track;
import java.util.List;
import java.util.Optional;

/**
 * One line of {@code /perks}: where a player stands in one track.
 *
 * @param track the track
 * @param level the player's level, 0 if untrained
 * @param primary whether it is the player's primary track
 * @param next the next level and its price, empty when maxed
 * @param problems why the next level cannot be bought now; empty when it can
 */
public record TrackStanding(
    Track track, int level, boolean primary, Optional<Quote> next, List<PurchaseProblem> problems) {

  public TrackStanding {
    problems = List.copyOf(problems);
  }

  /** Whether the next level can be bought right now. */
  public boolean buyable() {
    return next.isPresent() && problems.isEmpty();
  }
}
