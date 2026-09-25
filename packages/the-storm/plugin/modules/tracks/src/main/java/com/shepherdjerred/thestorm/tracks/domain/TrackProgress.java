package com.shepherdjerred.thestorm.tracks.domain;

import com.shepherdjerred.thestorm.tracks.app.Track;
import java.time.Instant;
import java.util.ArrayList;
import java.util.EnumSet;
import java.util.List;
import java.util.Optional;

/**
 * One player's progress in every track. Immutable; every change returns a new value.
 *
 * <p>{@code owned} lists the tracks the player has at least level I in, in the order they first
 * bought them. The first is the <em>primary</em> track, and no other track may be above its level.
 * A track's position in this order sets its price multiplier.
 *
 * @param owned the owned tracks in first-purchase order, each at most once
 * @param lastPurchase when the player last bought a level, for the purchase cooldown
 */
public record TrackProgress(List<TrackLevel> owned, Optional<Instant> lastPurchase) {

  private static final TrackProgress EMPTY = new TrackProgress(List.of(), Optional.empty());

  public TrackProgress {
    owned = List.copyOf(owned);
    var seen = EnumSet.noneOf(Track.class);
    for (var entry : owned) {
      if (!seen.add(entry.track())) {
        throw new IllegalArgumentException(entry.track() + " is owned twice: " + owned);
      }
    }
    if (!owned.isEmpty()) {
      var primary = owned.getFirst();
      for (var secondary : owned.subList(1, owned.size())) {
        if (secondary.level() > primary.level()) {
          throw new IllegalArgumentException(
              "secondary " + secondary + " is above primary " + primary);
        }
      }
    }
  }

  /** A player who has never trained. */
  public static TrackProgress empty() {
    return EMPTY;
  }

  /** The player's level in {@code track}, 0 if untrained. */
  public int level(Track track) {
    return owned.stream()
        .filter(entry -> entry.track() == track)
        .mapToInt(TrackLevel::level)
        .findFirst()
        .orElse(0);
  }

  /** The first track the player bought, if any. */
  public Optional<TrackLevel> primary() {
    return owned.stream().findFirst();
  }

  /** Whether {@code track} is the player's primary track. */
  public boolean isPrimary(Track track) {
    return primary().map(entry -> entry.track() == track).orElse(false);
  }

  /**
   * {@code track}'s index in first-purchase order: 0 for the primary. An untrained track would be
   * bought next, so its position is the number of tracks owned.
   */
  public int position(Track track) {
    for (var index = 0; index < owned.size(); index++) {
      if (owned.get(index).track() == track) {
        return index;
      }
    }
    return owned.size();
  }

  /**
   * {@code track} at {@code level} (0 removes it), keeping its place in the purchase order, or
   * appending it if it is new. Throws if the result would break the primary cap.
   */
  public TrackProgress withLevel(Track track, int level) {
    if (level < 0 || level > Track.MAX_LEVEL) {
      throw new IllegalArgumentException(
          "track level must be 0.." + Track.MAX_LEVEL + ": " + level);
    }
    var next = new ArrayList<TrackLevel>(owned.size() + 1);
    var found = false;
    for (var entry : owned) {
      if (entry.track() == track) {
        found = true;
        if (level > 0) {
          next.add(new TrackLevel(track, level));
        }
      } else {
        next.add(entry);
      }
    }
    if (!found && level > 0) {
      next.add(new TrackLevel(track, level));
    }
    return new TrackProgress(next, lastPurchase);
  }

  /** The progress after buying {@code level} of {@code track} at {@code at}. */
  public TrackProgress purchased(Track track, int level, Instant at) {
    return new TrackProgress(withLevel(track, level).owned(), Optional.of(at));
  }
}
