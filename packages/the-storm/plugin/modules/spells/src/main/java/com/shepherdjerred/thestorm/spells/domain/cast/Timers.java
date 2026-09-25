package com.shepherdjerred.thestorm.spells.domain.cast;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Keys that expire: cooldowns, silences, stealth, fall protection after Leap and personal-time
 * shifts. Main thread only. Time is passed in, never read, so tests control it.
 *
 * @param <K> what is timed
 */
public final class Timers<K> {

  private final Map<K, Instant> until = new HashMap<>();

  /** Starts (or restarts) {@code key} for {@code duration} from {@code now}. */
  public void start(K key, Duration duration, Instant now) {
    if (duration.isNegative()) {
      throw new IllegalArgumentException("a timer cannot run backwards: " + duration);
    }
    until.put(key, now.plus(duration));
  }

  /** How long {@code key} still runs; zero when it is not running. */
  public Duration remaining(K key, Instant now) {
    var end = until.get(key);
    if (end == null || !end.isAfter(now)) {
      return Duration.ZERO;
    }
    return Duration.between(now, end);
  }

  /** True while {@code key} runs. */
  public boolean running(K key, Instant now) {
    return !remaining(key, now).isZero();
  }

  /** Stops {@code key}; true if it was running. */
  public boolean stop(K key, Instant now) {
    var end = until.remove(key);
    return end != null && end.isAfter(now);
  }

  /** Removes and returns every key that has run out by {@code now}. */
  public List<K> expire(Instant now) {
    var expired = new ArrayList<K>();
    var entries = until.entrySet().iterator();
    while (entries.hasNext()) {
      var entry = entries.next();
      if (!entry.getValue().isAfter(now)) {
        expired.add(entry.getKey());
        entries.remove();
      }
    }
    return expired;
  }

  /** Every key still tracked, running or not yet expired by a sweep. */
  public List<K> keys() {
    return List.copyOf(until.keySet());
  }
}
