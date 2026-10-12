package com.shepherdjerred.thestorm.towns.app;

import java.util.ArrayList;
import java.util.List;
import java.util.function.Consumer;

/** Delivers {@link TownMilestones} to subscribers. Main thread only. */
final class TownMilestoneHub implements TownMilestones {

  private final List<Consumer<Milestone>> listeners = new ArrayList<>();

  @Override
  public Subscription subscribe(Consumer<Milestone> listener) {
    listeners.add(listener);
    return () -> listeners.remove(listener);
  }

  void publish(Milestone milestone) {
    List.copyOf(listeners).forEach(listener -> listener.accept(milestone));
  }
}
