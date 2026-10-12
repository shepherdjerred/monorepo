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

/**
 * Where a Rewind player has stood, so the clock can send them back about {@link #WINDOW} ago.
 *
 * <p>Only positions safe to teleport to are recorded; the adapter decides safety. The oldest sample
 * is dropped as soon as the one after it is itself {@link #WINDOW} old, so the landing spot is the
 * oldest position within the window, or the most recent one older than it. The buffer holds at most
 * {@code capacity} samples (600 covers a tick-rate trail over the window).
 *
 * @param samples oldest first
 * @param capacity the most samples kept
 */
public record RewindTrail(List<Sample> samples, int capacity) {

  /** How far back the clock reaches. */
  public static final Duration WINDOW = Duration.ofSeconds(30);

  /** Samples to keep for one per tick over the window. */
  public static final int DEFAULT_CAPACITY = 600;

  public RewindTrail {
    if (capacity < 1) {
      throw new IllegalArgumentException("capacity must be positive");
    }
    if (samples.size() > capacity) {
      throw new IllegalArgumentException("more samples than capacity");
    }
    samples = List.copyOf(samples);
  }

  public static RewindTrail empty() {
    return new RewindTrail(List.of(), DEFAULT_CAPACITY);
  }

  /** Records a safe position at {@code now}, dropping what has fallen out of the window. */
  public RewindTrail record(Vec3 position, Instant now) {
    var next = new ArrayList<>(samples);
    while (next.size() > 1 && now.isAfter(next.get(1).at().plus(WINDOW))) {
      next.removeFirst();
    }
    next.add(new Sample(position, now));
    while (next.size() > capacity) {
      next.removeFirst();
    }
    return new RewindTrail(next, capacity);
  }

  /** Where the clock would land the player: the oldest sample. */
  public Optional<Vec3> landing() {
    return samples.isEmpty() ? Optional.empty() : Optional.of(samples.getFirst().position());
  }

  public RewindTrail cleared() {
    return new RewindTrail(List.of(), capacity);
  }

  /**
   * A recorded position.
   *
   * @param position where the player stood
   * @param at when
   */
  public record Sample(Vec3 position, Instant at) {}
}
