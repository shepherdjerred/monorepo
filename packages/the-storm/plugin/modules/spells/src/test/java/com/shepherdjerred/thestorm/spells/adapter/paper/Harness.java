package com.shepherdjerred.thestorm.spells.adapter.paper;

import com.shepherdjerred.thestorm.core.config.ConfigFiles;
import com.shepherdjerred.thestorm.core.schedule.Cancellable;
import com.shepherdjerred.thestorm.core.schedule.Scheduler;
import com.shepherdjerred.thestorm.spells.domain.config.SpellsConfig;
import java.nio.file.Path;
import java.time.Duration;
import java.time.Instant;
import java.time.InstantSource;
import java.util.Objects;
import java.util.concurrent.Executor;
import org.bukkit.plugin.Plugin;
import org.mockbukkit.mockbukkit.MockBukkit;
import org.mockbukkit.mockbukkit.ServerMock;
import org.mockbukkit.mockbukkit.world.WorldMock;

/** A MockBukkit server with the shipped spells.yml, a hand-moved clock and an inline scheduler. */
final class Harness implements AutoCloseable {

  final ServerMock server = MockBukkit.mock();
  final Plugin plugin = MockBukkit.createMockPlugin("TheStorm");
  final WorldMock world = server.addSimpleWorld("world");
  final SpellsConfig config =
      ConfigFiles.load(
          Path.of(Objects.requireNonNull(System.getProperty("thestorm.spells.config"))),
          SpellsConfig.class);
  final Clock clock = new Clock();
  final Async async = new Async(new InlineScheduler(), plugin.getComponentLogger());

  @Override
  public void close() {
    MockBukkit.unmock();
  }

  /** A clock tests move by hand. */
  static final class Clock implements InstantSource {
    private Instant now = Instant.parse("2026-09-25T12:00:00Z");

    @Override
    public Instant instant() {
      return now;
    }

    void advance(Duration duration) {
      now = now.plus(duration);
    }
  }

  /** Runs main-thread work immediately, on the test thread. */
  static final class InlineScheduler implements Scheduler {

    @Override
    public void runOnMainThread(Runnable task) {
      task.run();
    }

    @Override
    public Cancellable runOnMainThreadLater(Duration delay, Runnable task) {
      throw new UnsupportedOperationException("tests run nothing later");
    }

    @Override
    public Cancellable repeatOnMainThread(Duration delay, Duration period, Runnable task) {
      throw new UnsupportedOperationException("tests tick by hand");
    }

    @Override
    public Executor mainThread() {
      return Runnable::run;
    }
  }
}
