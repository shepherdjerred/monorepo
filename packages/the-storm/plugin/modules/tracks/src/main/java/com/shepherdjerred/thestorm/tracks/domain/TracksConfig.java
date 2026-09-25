package com.shepherdjerred.thestorm.tracks.domain;

import com.shepherdjerred.thestorm.tracks.app.Track;
import java.time.Duration;
import java.util.Arrays;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * {@code plugins/TheStorm/tracks.yml}, owned by the repository.
 *
 * @param pricing level prices
 * @param purchaseCooldownMinutes the wait between two purchases by one player; 0 disables it
 * @param confirmSeconds how long a {@code /perks} confirmation stays open
 * @param tracks every track's presentation, keyed by {@link Track#id()}
 */
public record TracksConfig(
    Pricing pricing,
    long purchaseCooldownMinutes,
    int confirmSeconds,
    Map<String, TrackInfo> tracks) {

  /** The longest confirmation window, so a stale confirmation cannot linger. */
  public static final int MAX_CONFIRM_SECONDS = 300;

  public TracksConfig {
    tracks = Map.copyOf(tracks);
    if (purchaseCooldownMinutes < 0) {
      throw new IllegalArgumentException(
          "purchaseCooldownMinutes must not be negative: " + purchaseCooldownMinutes);
    }
    if (confirmSeconds < 1 || confirmSeconds > MAX_CONFIRM_SECONDS) {
      throw new IllegalArgumentException(
          "confirmSeconds must be 1.." + MAX_CONFIRM_SECONDS + ": " + confirmSeconds);
    }
    var expected =
        Arrays.stream(Track.values()).map(Track::id).collect(Collectors.toUnmodifiableSet());
    if (!tracks.keySet().equals(expected)) {
      throw new IllegalArgumentException(
          "tracks must list exactly " + sorted(expected) + ", found " + sorted(tracks.keySet()));
    }
  }

  /** The purchase cooldown; zero when disabled. */
  public Duration purchaseCooldown() {
    return Duration.ofMinutes(purchaseCooldownMinutes);
  }

  /** How long a confirmation stays open. */
  public Duration confirmWindow() {
    return Duration.ofSeconds(confirmSeconds);
  }

  /** {@code track}'s presentation. */
  public TrackInfo info(Track track) {
    var info = tracks.get(track.id());
    if (info == null) {
      throw new IllegalStateException("validated config lost track " + track.id());
    }
    return info;
  }

  private static String sorted(Set<String> ids) {
    return ids.stream().sorted().collect(Collectors.joining(", ", "[", "]"));
  }
}
