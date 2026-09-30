package com.shepherdjerred.thestorm.quests.domain.engine;

import com.shepherdjerred.thestorm.quests.domain.state.PlayerQuests;
import java.util.List;

/**
 * The result of a transition: the new state and what to do about it.
 *
 * @param state the player's state afterwards
 * @param effects what the server must do, in order
 */
public record Outcome(PlayerQuests state, List<Effect> effects) {

  public Outcome {
    effects = List.copyOf(effects);
  }

  /** No change. */
  public static Outcome unchanged(PlayerQuests state) {
    return new Outcome(state, List.of());
  }

  /** Whether anything happened. */
  public boolean changed(PlayerQuests before) {
    return !effects.isEmpty() || !state.equals(before);
  }
}
