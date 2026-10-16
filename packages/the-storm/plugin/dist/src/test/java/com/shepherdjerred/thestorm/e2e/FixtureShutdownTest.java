package com.shepherdjerred.thestorm.e2e;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;

import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;

final class FixtureShutdownTest {
  @Test
  void ignoresOtherPlugins() {
    var calls = new AtomicInteger();
    var shutdown = new FixtureShutdown(calls::incrementAndGet);

    shutdown.pluginDisabling("Citizens");
    shutdown.pluginDisabling("TheStormFixtures");

    assertEquals(0, calls.get());
  }

  @Test
  void cleansBeforeProductUnloadWithoutTouchingItsClosedClassloaderAgain() {
    var available = new AtomicBoolean(true);
    var calls = new AtomicInteger();
    var shutdown =
        new FixtureShutdown(
            () -> {
              if (!available.get()) throw new NoClassDefFoundError("product already unloaded");
              calls.incrementAndGet();
            });

    shutdown.pluginDisabling("TheStorm");
    available.set(false);
    shutdown.close();
    shutdown.pluginDisabling("TheStorm");

    assertEquals(1, calls.get());
  }

  @Test
  void directFixtureDisableStillCleansOnce() {
    var calls = new AtomicInteger();
    var shutdown = new FixtureShutdown(calls::incrementAndGet);

    shutdown.close();
    shutdown.close();
    shutdown.pluginDisabling("TheStorm");

    assertEquals(1, calls.get());
  }

  @Test
  void reportsClassloaderFailuresUnchanged() {
    var failure = new NoClassDefFoundError("synthetic missing product class");
    var shutdown =
        new FixtureShutdown(
            () -> {
              throw failure;
            });

    assertSame(
        failure,
        assertThrows(NoClassDefFoundError.class, () -> shutdown.pluginDisabling("TheStorm")));
  }
}
