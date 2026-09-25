package com.shepherdjerred.thestorm.tracks.domain;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.tracks.app.Track;

/**
 * Administrator overrides. They skip the price, the cooldown and the one-level-at-a-time rule, but
 * never break the primary cap or change the primary: that takes a {@link #reset}.
 */
public final class AdminChanges {

  private AdminChanges() {}

  /**
   * {@code progress} with {@code track} set to {@code level} (0 removes it). A track the player did
   * not own is appended to their purchase order, becoming the primary if they owned none.
   */
  public static Result<TrackProgress, AdminProblem> set(
      TrackProgress progress, Track track, int level) {
    if (level < 0 || level > Track.MAX_LEVEL) {
      throw new IllegalArgumentException(
          "track level must be 0.." + Track.MAX_LEVEL + ": " + level);
    }
    var primary = progress.primary();
    if (primary.isEmpty() || level == progress.level(track)) {
      return Result.ok(progress.withLevel(track, level));
    }
    var current = primary.get();
    if (current.track() != track) {
      return level > current.level()
          ? Result.err(
              new AdminProblem.AbovePrimary(track, level, current.track(), current.level()))
          : Result.ok(progress.withLevel(track, level));
    }
    return lowerOrRaisePrimary(progress, current, level);
  }

  /** A player with no levels, no primary and no cooldown. Nothing is refunded. */
  public static TrackProgress reset() {
    return TrackProgress.empty();
  }

  private static Result<TrackProgress, AdminProblem> lowerOrRaisePrimary(
      TrackProgress progress, TrackLevel primary, int level) {
    var secondaries = progress.owned().subList(1, progress.owned().size());
    if (level == 0 && !secondaries.isEmpty()) {
      return Result.err(new AdminProblem.WouldChangePrimary(primary.track()));
    }
    for (var secondary : secondaries) {
      if (secondary.level() > level) {
        return Result.err(
            new AdminProblem.BelowSecondary(
                primary.track(), level, secondary.track(), secondary.level()));
      }
    }
    return Result.ok(progress.withLevel(primary.track(), level));
  }
}
