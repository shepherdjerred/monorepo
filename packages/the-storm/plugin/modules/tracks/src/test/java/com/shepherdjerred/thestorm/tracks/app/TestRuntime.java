package com.shepherdjerred.thestorm.tracks.app;

import com.shepherdjerred.thestorm.tracks.domain.Progressions;
import java.time.Duration;
import java.time.Instant;
import java.time.InstantSource;
import org.slf4j.helpers.NOPLogger;

/** A {@link TrackRuntime} over fakes, with a clock tests move by hand and a same-thread "main". */
final class TestRuntime implements InstantSource {

  final InMemoryTrackStore store = new InMemoryTrackStore();
  final FakePermissionSync permissions = new FakePermissionSync();
  final LevelCache cache = new LevelCache();
  final TrackRuntime runtime =
      new TrackRuntime(store, permissions, cache, Runnable::run, this, NOPLogger.NOP_LOGGER);
  private Instant now = Progressions.NOW;

  @Override
  public Instant instant() {
    return now;
  }

  void advance(Duration duration) {
    now = now.plus(duration);
  }
}
