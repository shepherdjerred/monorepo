package com.shepherdjerred.thestorm.skills.app;

import java.util.ArrayList;
import java.util.List;
import java.util.function.Consumer;

/** Saved skill level-ups. Listeners run on the main thread. */
public final class SkillSignals {

  private final List<Consumer<SkillLevelUp>> listeners = new ArrayList<>();

  public void subscribe(Consumer<SkillLevelUp> listener) {
    listeners.add(listener);
  }

  public void publish(SkillLevelUp levelUp) {
    List.copyOf(listeners).forEach(listener -> listener.accept(levelUp));
  }
}
