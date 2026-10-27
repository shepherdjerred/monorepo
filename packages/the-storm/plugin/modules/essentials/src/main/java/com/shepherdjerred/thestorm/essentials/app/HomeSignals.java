package com.shepherdjerred.thestorm.essentials.app;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.function.Consumer;

/** A home was saved. Listeners run on the main thread. */
public final class HomeSignals {

  private final List<Consumer<UUID>> listeners = new ArrayList<>();

  public void subscribe(Consumer<UUID> listener) {
    listeners.add(listener);
  }

  public void saved(UUID player) {
    List.copyOf(listeners).forEach(listener -> listener.accept(player));
  }
}
