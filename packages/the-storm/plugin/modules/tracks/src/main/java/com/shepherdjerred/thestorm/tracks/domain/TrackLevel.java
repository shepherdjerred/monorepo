package com.shepherdjerred.thestorm.tracks.domain;

import com.shepherdjerred.thestorm.tracks.app.Track;

/**
 * A level a player owns in one track.
 *
 * @param track the track
 * @param level 1 to {@link Track#MAX_LEVEL}; an untrained track has no {@code TrackLevel}
 */
public record TrackLevel(Track track, int level) {

  public TrackLevel {
    if (level < 1 || level > Track.MAX_LEVEL) {
      throw new IllegalArgumentException(
          "an owned track level must be 1.." + Track.MAX_LEVEL + ": " + level);
    }
  }
}
