package com.shepherdjerred.thestorm.mobs.app;

import java.time.Duration;
import java.time.Instant;
import java.time.InstantSource;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.function.BiConsumer;
import java.util.function.Consumer;

/** Independent of analytics and historical Minecraft statistics. Serialized across async chat. */
public final class BeginnerClock {
  private static final Duration CHECKPOINT = Duration.ofMinutes(1);
  private final InstantSource time;
  private final BeginnerTimeStore store;
  private final Consumer<Throwable> failed;
  private final BiConsumer<UUID, Long> advanced;
  private final Map<UUID, Entry> entries = new HashMap<>();
  private final CompletableFuture<Void> ready;

  private static final class Entry {
    long millis;
    Instant checkpoint;
    Instant saved;
    boolean enabled;
    boolean active;

    Entry(long millis, Instant now) {
      if (millis < 0) throw new IllegalArgumentException("negative active playtime");
      this.millis = millis;
      this.checkpoint = now;
      this.saved = now;
    }
  }

  public BeginnerClock(
      InstantSource time,
      BeginnerTimeStore store,
      Consumer<Throwable> failed,
      BiConsumer<UUID, Long> advanced) {
    this.time = time;
    this.store = store;
    this.failed = failed;
    this.advanced = advanced;
    ready = store.load().thenAccept(this::loaded);
    var _ =
        ready.whenComplete(
            (value, failure) -> {
              if (failure != null) failed.accept(failure);
            });
  }

  private synchronized void loaded(Map<UUID, Long> saved) {
    var now = time.instant();
    saved.forEach((id, millis) -> entries.put(id, new Entry(millis, now)));
  }

  public CompletableFuture<Void> ready() {
    return ready;
  }

  /** A missing flag decision is not an enabled session. False pauses without deleting progress. */
  public synchronized void enabled(UUID id, boolean enabled, boolean active) {
    requireReady();
    var entry = entries.get(id);
    if (entry == null) {
      if (!enabled) return;
      entry = new Entry(0, time.instant());
      entries.put(id, entry);
    }
    advance(id, entry);
    entry.enabled = enabled;
    entry.active = enabled && active;
    save(id, entry);
  }

  public synchronized void activity(UUID id, boolean active) {
    var entry = entries.get(id);
    if (entry == null) return;
    advance(id, entry);
    var paused = entry.active && !active;
    entry.active = entry.enabled && active;
    if (paused || !time.instant().isBefore(entry.saved.plus(CHECKPOINT))) save(id, entry);
  }

  public synchronized long millis(UUID id) {
    requireReady();
    var entry = entries.get(id);
    if (entry == null) return 0;
    return Math.addExact(entry.millis, entry.active ? elapsed(entry.checkpoint) : 0);
  }

  public synchronized boolean enabled(UUID id) {
    var entry = entries.get(id);
    return entry != null && entry.enabled;
  }

  public synchronized void close() {
    entries.forEach(
        (id, entry) -> {
          advance(id, entry);
          entry.active = false;
          entry.enabled = false;
          save(id, entry);
        });
  }

  private void advance(UUID id, Entry entry) {
    if (entry.active) entry.millis = Math.addExact(entry.millis, elapsed(entry.checkpoint));
    entry.checkpoint = time.instant();
    advanced.accept(id, entry.millis);
  }

  private long elapsed(Instant from) {
    var millis = Duration.between(from, time.instant()).toMillis();
    if (millis < 0) throw new IllegalStateException("beginner playtime clock moved backwards");
    return millis;
  }

  private void save(UUID id, Entry entry) {
    entry.saved = time.instant();
    var _ =
        store
            .save(id, entry.millis)
            .whenComplete(
                (value, failure) -> {
                  if (failure != null) failed.accept(failure);
                });
  }

  private void requireReady() {
    if (!ready.isDone() || ready.isCompletedExceptionally()) {
      throw new IllegalStateException("beginner playtime has not loaded");
    }
  }
}
