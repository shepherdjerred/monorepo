package com.shepherdjerred.thestorm.tracks.domain;

import com.shepherdjerred.thestorm.tracks.app.Track;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;
import java.util.Optional;

/** Reading track ids typed by players and admins. */
public final class TrackIds {

  private TrackIds() {}

  /** The track whose {@link Track#id()} is {@code id}, ignoring case. */
  public static Optional<Track> parse(String id) {
    var wanted = id.toLowerCase(Locale.ROOT);
    return Arrays.stream(Track.values()).filter(track -> track.id().equals(wanted)).findFirst();
  }

  /** Every track id, in {@link Track} order. */
  public static List<String> all() {
    return Arrays.stream(Track.values()).map(Track::id).toList();
  }
}
