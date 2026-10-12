// Ported from libraryaddict's Red Warfare
// (redwarfare-arcade/src/me/libraryaddict/arcade/game/searchanddestroy/abilities/RewinderAbility.java);
// see packages/the-storm/NOTICE.
package com.shepherdjerred.thestorm.rwf.domain.kit;

import com.shepherdjerred.thestorm.rwf.domain.geometry.Vec3;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.function.Predicate;

/**
 * Where a Rewind player has stood, so the clock can send them back about {@link #WINDOW} ago.
 *
 * <p>The adapter records every tick the player stands somewhere {@linkplain SafeTeleport safe}, and
 * {@linkplain #trimmed trims} the trail every tick, as the original did: the oldest sample is
 * dropped once the one after it is itself {@link #WINDOW} old, unless the oldest is still safe and
 * the next is not. The landing spot is therefore the oldest safe position within the window, or the
 * most recent one older than it. Like the original, the trail has no other bound: it is cleared on
 * every use and death and dropped at the end of the match.
 *
 * @param samples oldest first
 */
public record RewindTrail(List<Sample> samples) {

  /** How far back the clock reaches. */
  public static final Duration WINDOW = Duration.ofSeconds(30);

  public RewindTrail {
    samples = List.copyOf(samples);
  }

  public static RewindTrail empty() {
    return new RewindTrail(List.of());
  }

  /** Records a safe spot at {@code now}. */
  public RewindTrail record(Spot spot, Instant now) {
    var next = new ArrayList<>(samples);
    next.add(new Sample(spot, now));
    return new RewindTrail(next);
  }

  /**
   * Drops the samples that have fallen out of the window at {@code now}: while the second sample is
   * itself more than {@link #WINDOW} old, the first goes, unless it is still {@code safe} and the
   * second is not.
   */
  public RewindTrail trimmed(Instant now, Predicate<Vec3> safe) {
    var first = 0;
    while (samples.size() - first > 1
        && now.isAfter(samples.get(first + 1).at().plus(WINDOW))
        && (!safe.test(samples.get(first).spot().position())
            || safe.test(samples.get(first + 1).spot().position()))) {
      first++;
    }
    return first == 0 ? this : new RewindTrail(samples.subList(first, samples.size()));
  }

  /** Where the clock would land the player: the oldest sample. */
  public Optional<Spot> landing() {
    return samples.isEmpty() ? Optional.empty() : Optional.of(samples.getFirst().spot());
  }

  public RewindTrail cleared() {
    return empty();
  }

  /**
   * Where a player stood and which way they faced.
   *
   * @param position their feet
   * @param yaw where they looked, in degrees
   * @param pitch how far up or down they looked, in degrees
   */
  public record Spot(Vec3 position, float yaw, float pitch) {}

  /**
   * A recorded spot.
   *
   * @param spot where the player stood
   * @param at when
   */
  public record Sample(Spot spot, Instant at) {}
}
