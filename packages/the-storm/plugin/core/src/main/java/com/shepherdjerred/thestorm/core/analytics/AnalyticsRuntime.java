package com.shepherdjerred.thestorm.core.analytics;

import com.shepherdjerred.thestorm.core.db.StormDatabase;
import java.time.InstantSource;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executor;
import net.kyori.adventure.text.logger.slf4j.ComponentLogger;
import org.jspecify.annotations.Nullable;

/**
 * Optional analytics runtime. Enabling never performs database or network I/O on Paper's thread.
 */
public final class AnalyticsRuntime implements ProductAnalytics, AutoCloseable {
  private final StormDatabase database;
  private final InstantSource time;
  private final ComponentLogger logger;
  private volatile @Nullable SessionBook book;
  private @Nullable AnalyticsExporter exporter;
  private volatile boolean stopped;
  private final Map<UUID, Mode> modes = new ConcurrentHashMap<>();
  private final Set<UUID> away = ConcurrentHashMap.newKeySet();

  public AnalyticsRuntime(StormDatabase database, InstantSource time, ComponentLogger logger) {
    this.database = database;
    this.time = time;
    this.logger = logger;
  }

  /** Recover durable sessions before accepting events, completing activation on the main thread. */
  public CompletableFuture<Void> start(AnalyticsBootstrap bootstrap, Executor mainThread) {
    var store = new AnalyticsStore(database, bootstrap.stage());
    return store
        .recover()
        .thenAcceptAsync(
            done -> {
              if (stopped) return;
              exporter = new AnalyticsExporter(store, new PostHogTransport(bootstrap));
              book =
                  new SessionBook(
                      time, UUID::randomUUID, write -> observe(store.save(write), "persist"));
              flush();
              logger.info("Product analytics enabled for {}", bootstrap.stage());
            },
            mainThread);
  }

  public void joined(UUID player, String name) {
    var current = book;
    if (current != null) {
      current.joined(player, name);
      current.mode(player, modes.getOrDefault(player, Mode.SURVIVAL));
      current.afk(player, away.contains(player));
    }
  }

  public void left(UUID player) {
    var current = book;
    if (current != null) current.left(player, "disconnect");
    flush();
    modes.remove(player);
    away.remove(player);
  }

  public void heartbeat() {
    var current = book;
    if (current != null) current.checkpoint();
    flush();
  }

  private void flush() {
    var current = exporter;
    if (current != null) observe(current.flush(), "deliver; queued events will retry");
  }

  @Override
  public void interaction(UUID player, Action action) {
    var current = book;
    if (current != null) current.interaction(player, action);
  }

  @Override
  public void mode(UUID player, Mode mode) {
    if (mode == Mode.SURVIVAL) modes.remove(player);
    else modes.put(player, mode);
    var current = book;
    if (current != null) current.mode(player, mode);
  }

  @Override
  public void afk(UUID player, boolean away) {
    if (away) this.away.add(player);
    else this.away.remove(player);
    var current = book;
    if (current != null) current.afk(player, away);
  }

  @Override
  public void close() {
    stopped = true;
    var current = book;
    book = null;
    if (current != null) current.stop();
    var sender = exporter;
    if (sender != null) sender.close();
    exporter = null;
  }

  private void observe(CompletableFuture<?> future, String operation) {
    var _ =
        future.whenComplete(
            (done, failure) -> {
              if (failure != null)
                logger.error("Product analytics could not {}", operation, failure);
            });
  }
}
