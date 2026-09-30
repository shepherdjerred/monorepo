package com.shepherdjerred.thestorm.quests.app;

import com.shepherdjerred.thestorm.quests.domain.engine.QuestEngine.Context;
import com.shepherdjerred.thestorm.quests.domain.state.PlayerQuests;

/** Resolves authored dialogue text for a player without changing quest state. */
@FunctionalInterface
public interface QuestTextRenderer {

  /** Returns dialogue text, possibly rendered from an authored script. */
  String render(String source, PlayerQuests state, Context context);
}
