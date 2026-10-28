package com.shepherdjerred.thestorm.mechanics.adapter.paper;

import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import org.jspecify.annotations.Nullable;

/** Each asynchronous trip owns only its own guard entry. Main thread only. */
final class PendingGateTrips<T> {
  static final class Entry<T> {
    private final T value;

    Entry(T value) {
      this.value = value;
    }
  }

  private final Map<UUID, Entry<T>> entries = new HashMap<>();

  Entry<T> start(UUID player, T value) {
    var entry = new Entry<>(value);
    entries.put(player, entry);
    return entry;
  }

  void finish(UUID player, Entry<T> entry) {
    entries.remove(player, entry);
  }

  @Nullable T get(UUID player) {
    var entry = entries.get(player);
    return entry == null ? null : entry.value;
  }
}
