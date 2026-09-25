package com.shepherdjerred.thestorm.shards.adapter.paper;

import com.shepherdjerred.thestorm.core.config.ConfigFiles;
import com.shepherdjerred.thestorm.core.schedule.Cancellable;
import com.shepherdjerred.thestorm.core.schedule.Scheduler;
import com.shepherdjerred.thestorm.shards.domain.Bonuses;
import com.shepherdjerred.thestorm.shards.domain.ShardsConfig;
import java.nio.file.Path;
import java.time.Duration;
import java.time.Instant;
import java.time.InstantSource;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;
import java.util.concurrent.Executor;
import java.util.random.RandomGenerator;
import org.bukkit.NamespacedKey;
import org.bukkit.plugin.Plugin;
import org.mockbukkit.mockbukkit.MockBukkit;
import org.mockbukkit.mockbukkit.ServerMock;
import org.mockbukkit.mockbukkit.world.WorldMock;

/** A MockBukkit server with the shipped config and the shards adapter pieces wired up. */
final class Harness implements AutoCloseable {

  final ServerMock server = MockBukkit.mock();
  final Plugin plugin = MockBukkit.createMockPlugin("TheStorm");
  final WorldMock world = server.addSimpleWorld("world");
  final ShardsConfig config =
      ConfigFiles.load(
          Path.of(Objects.requireNonNull(System.getProperty("thestorm.shards.config"))),
          ShardsConfig.class);
  final Bonuses bonuses = new Bonuses(config.bonuses());
  final ShardText text = new ShardText(config.messages(), config.upgrades().loreLine());
  final StormGear gear =
      new StormGear(
          new NamespacedKey(plugin, "storm_tier"),
          new NamespacedKey(plugin, "storm_gear"),
          bonuses,
          text);
  final ShardItems shards = new ShardItems(new NamespacedKey(plugin, "shard"), gear, config.item());
  final Clock clock = new Clock();
  final RecordingScheduler scheduler = new RecordingScheduler();

  /** The kit with a random whose every roll is {@code roll}. */
  ShardKit kit(double roll) {
    return new ShardKit(shards, gear, text, new FixedRandom(roll), clock);
  }

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

  /** Every roll returns the same value, so outcomes are chosen by the test. */
  record FixedRandom(double roll) implements RandomGenerator {
    @Override
    public double nextDouble() {
      return roll;
    }

    @Override
    public int nextInt(int origin, int bound) {
      return origin;
    }

    @Override
    public long nextLong() {
      return 0;
    }
  }

  /** Records scheduled work without running it. */
  static final class RecordingScheduler implements Scheduler {
    final List<Duration> delays = new ArrayList<>();

    @Override
    public void runOnMainThread(Runnable task) {
      delays.add(Duration.ZERO);
    }

    @Override
    public Cancellable runOnMainThreadLater(Duration delay, Runnable task) {
      delays.add(delay);
      return () -> {};
    }

    @Override
    public Cancellable repeatOnMainThread(Duration delay, Duration period, Runnable task) {
      throw new UnsupportedOperationException("shards never repeats");
    }

    @Override
    public Executor mainThread() {
      return Runnable::run;
    }
  }
}
