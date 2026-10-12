package com.shepherdjerred.thestorm.rwfbots.domain.tactics;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

/**
 * The bot's own model of rwf's Rewinder rule, so the REWIND option is only taken when the Time
 * Machine would work and land somewhere useful: the clock starts on a 30 s cooldown when the match
 * goes live and again after each use, and sends the player to the oldest position of a trail that
 * reaches back 30 s (rwf's {@code RewindTrail}). The trail is sampled every {@link #SAMPLE_TICKS}
 * rather than every tick, which only matters to within a couple of blocks.
 *
 * @param readyAt the tick the clock may next be used, or -1 before the match has been seen live
 * @param trail positions the bot has stood at, oldest first
 */
public record RewindClock(long readyAt, List<Sample> trail) {

  /** rwf's Rewinder cooldown and RewindTrail window, in ticks. */
  public static final long COOLDOWN_TICKS = 600;

  public static final long WINDOW_TICKS = 600;

  /** How often the bot notes where it stands. */
  public static final long SAMPLE_TICKS = 40;

  public static final RewindClock UNSTARTED = new RewindClock(-1, List.of());

  /**
   * A remembered position.
   *
   * @param pos where the bot stood
   * @param tick when
   */
  public record Sample(Vec3 pos, long tick) {}

  public RewindClock {
    trail = List.copyOf(trail);
  }

  /** Starts the clock at {@code now} if it has not started, and notes the bot at {@code pos}. */
  public RewindClock track(Vec3 pos, long now) {
    var ready = readyAt < 0 ? now + COOLDOWN_TICKS : readyAt;
    if (!trail.isEmpty() && now - trail.getLast().tick() < SAMPLE_TICKS) {
      return ready == readyAt ? this : new RewindClock(ready, trail);
    }
    var next = new ArrayList<>(trail);
    while (next.size() > 1 && now > next.get(1).tick() + WINDOW_TICKS) {
      next.removeFirst();
    }
    next.add(new Sample(pos, now));
    return new RewindClock(ready, next);
  }

  /** Where the clock would send the bot now. */
  public Optional<Vec3> landing() {
    return trail.isEmpty() ? Optional.empty() : Optional.of(trail.getFirst().pos());
  }

  public boolean ready(long now) {
    return readyAt >= 0 && now >= readyAt && !trail.isEmpty();
  }

  /** The clock was used at {@code now}: the trail is spent and the cooldown restarts. */
  public RewindClock used(long now) {
    return new RewindClock(now + COOLDOWN_TICKS, List.of());
  }
}
