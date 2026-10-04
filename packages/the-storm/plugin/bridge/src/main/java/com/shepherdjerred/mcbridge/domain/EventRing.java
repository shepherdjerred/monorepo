package com.shepherdjerred.mcbridge.domain;

import java.time.InstantSource;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.List;
import org.jspecify.annotations.Nullable;

/** A bounded, thread-safe ring of events with a monotonically increasing cursor. */
public final class EventRing {
  private final int capacity;
  private final InstantSource time;
  private final Deque<BridgeEvent> events;
  private long lastSeq;

  /**
   * One page of events.
   *
   * @param cursor pass as {@code since} next time
   * @param truncated true when events after {@code since} were already evicted
   * @param events the events, oldest first
   */
  public record Page(long cursor, boolean truncated, List<BridgeEvent> events) {}

  public EventRing(int capacity, InstantSource time) {
    if (capacity < 1) {
      throw new IllegalArgumentException("capacity must be positive");
    }
    this.capacity = capacity;
    this.time = time;
    this.events = new ArrayDeque<>(capacity);
  }

  /** Appends an event, evicting the oldest one when full. */
  public synchronized void add(EventType type, @Nullable String player, String text) {
    lastSeq++;
    if (events.size() == capacity) {
      events.removeFirst();
    }
    events.addLast(new BridgeEvent(lastSeq, time.instant(), type, player, text));
  }

  /** Events with {@code seq > since}, oldest first, at most {@code limit} of them. */
  public synchronized Page since(long since, int limit) {
    if (since < 0) {
      throw BridgeException.badRequest("since must not be negative");
    }
    if (limit < 1) {
      throw BridgeException.badRequest("limit must be positive");
    }
    List<BridgeEvent> page = new ArrayList<>();
    long oldestRetained = events.isEmpty() ? lastSeq + 1 : events.getFirst().seq();
    boolean truncated = since + 1 < oldestRetained && since < lastSeq;
    long cursor = Math.min(since, lastSeq);
    for (BridgeEvent event : events) {
      if (event.seq() > since && page.size() < limit) {
        page.add(event);
        cursor = event.seq();
      }
    }
    return new Page(cursor, truncated, List.copyOf(page));
  }

  /** The sequence number of the newest event; pass as {@code since} to read only later ones. */
  public synchronized long cursor() {
    return lastSeq;
  }

  /** The newest {@code limit} events attributed to {@code player}, oldest first. */
  public synchronized List<BridgeEvent> recentFor(String player, int limit) {
    if (limit < 1) {
      throw BridgeException.badRequest("limit must be positive");
    }
    List<BridgeEvent> matching = new ArrayList<>();
    for (BridgeEvent event : events) {
      if (player.equals(event.player())) {
        matching.add(event);
      }
    }
    int from = Math.max(0, matching.size() - limit);
    return List.copyOf(matching.subList(from, matching.size()));
  }
}
