package com.shepherdjerred.thestorm.tracks.domain;

import java.time.Duration;
import java.time.Instant;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;
import java.util.function.Predicate;

/**
 * Two-step commands: the first run offers something, and running it again within {@code window}
 * confirms it. Each key holds at most one open offer; a new offer replaces it. Not thread-safe:
 * used only on the main thread.
 *
 * @param <K> who is confirming (a player or a command sender)
 * @param <T> what they are confirming
 */
public final class Confirmations<K, T> {

  private final Duration window;
  private final Map<K, Offer<T>> open = new HashMap<>();

  public Confirmations(Duration window) {
    if (window.isNegative() || window.isZero()) {
      throw new IllegalArgumentException("confirmation window must be positive: " + window);
    }
    this.window = window;
  }

  /** Opens an offer of {@code value} to {@code key} at {@code now}, replacing any earlier one. */
  public void offer(K key, T value, Instant now) {
    open.put(key, new Offer<>(value, now));
  }

  /**
   * Takes {@code key}'s open offer if it matches {@code wanted} and was made no more than {@code
   * window} before {@code now}. A matching offer is consumed; an expired one is discarded.
   */
  public Optional<T> confirm(K key, Predicate<? super T> wanted, Instant now) {
    var offer = open.get(key);
    if (offer == null) {
      return Optional.empty();
    }
    if (now.isAfter(offer.at().plus(window))) {
      open.remove(key);
      return Optional.empty();
    }
    if (!wanted.test(offer.value())) {
      return Optional.empty();
    }
    open.remove(key);
    return Optional.of(offer.value());
  }

  /** Drops {@code key}'s open offer, for example when a player leaves. */
  public void forget(K key) {
    open.remove(key);
  }

  private record Offer<T>(T value, Instant at) {}
}
