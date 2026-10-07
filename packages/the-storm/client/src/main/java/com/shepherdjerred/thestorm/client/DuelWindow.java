package com.shepherdjerred.thestorm.client;

import com.shepherdjerred.thestorm.client.wire.DuelMarker;
import java.util.ArrayList;
import java.util.List;
import org.jspecify.annotations.Nullable;

/** Native-tick window and pixel provenance. The first live packet anchors the rendered clock. */
final class DuelWindow {
  static final int LIVE_TICKS = 600;
  static final int FRAMES = 900;
  static final String WINDOW = "first-600-live-ticks-hold-terminal-frame";

  record Binding(int index, long markerReceivedNanos, DuelMarker marker, int sourceFrame) {}

  record Receipt(
      String window,
      int liveTicks,
      int frames,
      long startedElapsedNanos,
      int terminalFrame,
      DuelTimeline.Receipt clock,
      List<Binding> bindings) {}

  private final DuelTimeline timeline;
  private final long armedAt;
  private final List<Binding> bindings = new ArrayList<>();
  private @Nullable DuelMarker latest;
  private long received;
  private long started;
  private boolean anchored;
  private int terminalFrame = -1;

  DuelWindow(DuelTimeline.Expected expected, long now) {
    timeline = new DuelTimeline(expected, now);
    armedAt = now;
  }

  boolean accept(DuelMarker marker, long now) {
    timeline.accept(marker, now);
    if (timeline.state().equals("FAILED")) throw new IllegalStateException(timeline.error());
    if (marker.marker().equals("begin")) return false;
    if (marker.elapsed() < 0 || marker.elapsed() >= LIVE_TICKS)
      throw new IllegalStateException("Native capture window ended before all rendered slots");
    if (marker.marker().equals("terminal")
        && !List.of("win", "loss", "draw", "timeout").contains(marker.result()))
      throw new IllegalStateException("Native capture duel was interrupted");
    latest = marker;
    received = now;
    if (anchored) return false;
    if (!marker.marker().equals("tick") || marker.elapsed() != 0)
      throw new IllegalStateException("Native capture missed its first live tick");
    started = now;
    anchored = true;
    return true;
  }

  Binding bind(int index, long now) {
    var marker = java.util.Objects.requireNonNull(latest, "No live native marker was received");
    if (!anchored || index != bindings.size() || index >= FRAMES || now < received)
      throw new IllegalStateException("Native frame binding clock or inventory changed");
    if (index == 0 && marker.elapsed() != 0)
      throw new IllegalStateException("Native capture missed its first live render");
    if (terminalFrame < 0 && marker.marker().equals("terminal")) terminalFrame = index;
    var source = terminalFrame < 0 ? index : terminalFrame;
    var binding = new Binding(index, received - started, marker, source);
    bindings.add(binding);
    return binding;
  }

  void complete() {
    var marker = latest;
    if (bindings.size() != FRAMES || marker == null || !anchored)
      throw new IllegalStateException("Native rendered window is incomplete");
    if (terminalFrame < 0 && marker.elapsed() != LIVE_TICKS - 1)
      throw new IllegalStateException("Native rendered window did not reach live tick 599");
  }

  Receipt receipt() {
    return new Receipt(
        WINDOW,
        LIVE_TICKS,
        FRAMES,
        anchored ? started - armedAt : -1,
        terminalFrame,
        timeline.receipt(),
        List.copyOf(bindings));
  }
}
