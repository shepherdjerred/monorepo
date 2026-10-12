package com.shepherdjerred.thestorm.arena.adapter.paper;

import com.shepherdjerred.thestorm.arena.app.ArenaEvents;
import com.shepherdjerred.thestorm.arena.app.ArenaNotification;
import java.util.ArrayList;
import java.util.List;
import java.util.function.Consumer;

/** Delivers arena transitions to subscribers; a failing listener never reaches the game. */
final class ArenaEventHub implements ArenaEvents {

  private final PaperContext context;
  private final List<Consumer<ArenaNotification>> listeners = new ArrayList<>();

  ArenaEventHub(PaperContext context) {
    this.context = context;
  }

  @Override
  public Subscription subscribe(Consumer<ArenaNotification> listener) {
    listeners.add(listener);
    return () -> listeners.remove(listener);
  }

  void publish(ArenaNotification notification) {
    for (var listener : List.copyOf(listeners)) {
      context.guarded("notifying an arena listener", () -> listener.accept(notification));
    }
  }
}
