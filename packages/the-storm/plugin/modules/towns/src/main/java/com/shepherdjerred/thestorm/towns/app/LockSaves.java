package com.shepherdjerred.thestorm.towns.app;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.function.Consumer;

/** A lock was saved for its owner. Listeners run on the main thread. There is no owner index. */
public final class LockSaves {

  private final List<Consumer<UUID>> listeners = new ArrayList<>();

  public void subscribe(Consumer<UUID> listener) {
    listeners.add(listener);
  }

  public void saved(UUID owner) {
    List.copyOf(listeners).forEach(listener -> listener.accept(owner));
  }
}
