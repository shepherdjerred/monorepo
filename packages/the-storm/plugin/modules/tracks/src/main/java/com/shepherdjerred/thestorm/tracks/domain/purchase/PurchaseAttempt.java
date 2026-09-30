package com.shepherdjerred.thestorm.tracks.domain.purchase;

import com.shepherdjerred.thestorm.tracks.app.Track;
import com.shepherdjerred.thestorm.tracks.domain.TrackProgress;
import java.time.Instant;

/**
 * A player asking to buy {@code level} of {@code track}.
 *
 * @param progress the player's progress before the purchase
 * @param track the track
 * @param level the level asked for
 * @param now when
 * @param balance the player's crystals
 */
public record PurchaseAttempt(
    TrackProgress progress, Track track, int level, Instant now, long balance) {

  /** An attempt at the level after {@code track}'s current one. */
  public static PurchaseAttempt next(
      TrackProgress progress, Track track, Instant now, long balance) {
    return new PurchaseAttempt(progress, track, progress.level(track) + 1, now, balance);
  }

  /** Whether {@link #level} is a real level (1 to {@link Track#MAX_LEVEL}). */
  public boolean levelExists() {
    return level >= 1 && level <= Track.MAX_LEVEL;
  }
}
