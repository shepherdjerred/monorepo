package com.shepherdjerred.thestorm.client;

import com.shepherdjerred.thestorm.client.wire.DuelMarker;
import java.util.ArrayList;
import java.util.List;
import org.jspecify.annotations.Nullable;

/**
 * Strict receiver state. Supplied timestamps make clock and lifecycle failures independently
 * testable.
 */
final class DuelTimeline {
  record Expected(long seed, String side, String mode, String opponent) {}

  record Entry(DuelMarker marker, long receivedElapsedNanos) {}

  record Receipt(
      int schema,
      String kind,
      String acceptance,
      String source,
      Expected expected,
      boolean complete,
      String error,
      List<Entry> entries) {}

  private final Expected expected;
  private final long armedAt;
  private final List<Entry> entries = new ArrayList<>();
  private String state = "ARMED";
  private String error = "";
  private @Nullable DuelMarker begin;
  private @Nullable DuelMarker lastTick;

  DuelTimeline(Expected expected, long armedAt) {
    if (expected.seed() < -DuelMarker.MAXIMUM_SAFE_INTEGER
        || expected.seed() > DuelMarker.MAXIMUM_SAFE_INTEGER
        || !DuelMarker.SIDES.contains(expected.side())
        || !DuelMarker.MODES.contains(expected.mode())
        || !DuelMarker.OPPONENTS.contains(expected.opponent()))
      throw new IllegalArgumentException("Invalid expected duel identity");
    this.expected = expected;
    this.armedAt = armedAt;
  }

  void accept(DuelMarker marker, long now) {
    if (state.equals("FAILED")) return;
    try {
      var elapsed = envelope(marker, now);
      advance(marker);
      entries.add(new Entry(marker, elapsed));
    } catch (IllegalStateException failure) {
      fail(failure.toString());
    }
  }

  private long envelope(DuelMarker marker, long now) {
    var elapsed = now - armedAt;
    if (elapsed < 0 || (!entries.isEmpty() && elapsed < entries.getLast().receivedElapsedNanos()))
      throw new IllegalStateException("Duel receive clock moved backwards");
    if (marker.seed() != expected.seed()
        || !marker.side().equals(expected.side())
        || !marker.mode().equals(expected.mode())
        || !marker.opponent().equals(expected.opponent()))
      throw new IllegalStateException("Duel marker differs from armed identity");
    if (marker.sequence() != entries.size() || entries.size() >= DuelMarker.MAXIMUM_ELAPSED + 3)
      throw new IllegalStateException("Duel markers are missing, duplicated or out of order");
    return elapsed;
  }

  private void advance(DuelMarker marker) {
    var initial = begin;
    if (initial == null) {
      if (!marker.marker().equals("begin"))
        throw new IllegalStateException("Duel begin marker is missing");
      begin = marker;
      state = "WAITING";
      return;
    }
    if (!initial.match().equals(marker.match())
        || marker.worldTick() < entries.getLast().marker().worldTick())
      throw new IllegalStateException("Duel match or world clock changed");
    switch (marker.marker()) {
      case "tick" -> live(marker);
      case "terminal" -> terminal(marker);
      default -> throw new IllegalStateException("Duplicate duel begin marker");
    }
  }

  private void live(DuelMarker marker) {
    if (!state.equals("WAITING") && !state.equals("LIVE"))
      throw new IllegalStateException("Duel tick arrived after terminal state");
    var previous = lastTick;
    if ((previous == null && marker.elapsed() != 0)
        || (previous != null
            && (marker.tick() != previous.tick() + 1
                || marker.elapsed() != previous.elapsed() + 1)))
      throw new IllegalStateException("Duel live ticks are not continuous");
    lastTick = marker;
    state = "LIVE";
  }

  private void terminal(DuelMarker marker) {
    if (!state.equals("WAITING") && !state.equals("LIVE"))
      throw new IllegalStateException("Duplicate duel terminal marker");
    var previous = lastTick;
    if ((previous == null && marker.elapsed() != -1)
        || (previous != null
            && (marker.tick() != previous.tick() || marker.elapsed() != previous.elapsed())))
      throw new IllegalStateException("Duel terminal clock differs from last live tick");
    state = "TERMINAL";
  }

  void fail(String reason) {
    if (error.isEmpty()) error = reason;
    state = "FAILED";
  }

  String state() {
    return state;
  }

  int count() {
    return entries.size();
  }

  String error() {
    return error;
  }

  Receipt receipt() {
    return new Receipt(
        1,
        "rwf-native-duel-clock",
        "unaccepted",
        "paper-custom-payload",
        expected,
        state.equals("TERMINAL"),
        error,
        List.copyOf(entries));
  }
}
