package com.shepherdjerred.thestorm.quests.domain.engine;

import com.shepherdjerred.thestorm.quests.domain.model.Action;

/** Something the server must do or tell the player after a quest transition. In order. */
public sealed interface Effect {

  /** Carry out a world action on behalf of {@code quest}. */
  record World(String quest, Action action) implements Effect {}

  /** NPC {@code npc} says {@code text} to the player. */
  record Say(String npc, String text) implements Effect {}

  /** The player took {@code quest}. */
  record Accepted(String quest) implements Effect {}

  /** {@code quest} moved to {@code stage}. */
  record StageStarted(String quest, String stage) implements Effect {}

  /** Objective {@code objective} of {@code stage} counted up. */
  record Progressed(String quest, String stage, int objective, int count, int required)
      implements Effect {}

  /** {@code quest} waits for the player to choose at its giver. */
  record ChoiceNeeded(String quest) implements Effect {}

  /** {@code quest} is complete. */
  record Completed(String quest) implements Effect {}

  /** {@code quest} failed (a branch led to failure or time ran out). */
  record Failed(String quest) implements Effect {}

  /** The player dropped {@code quest}, or it expired from the board. */
  record Abandoned(String quest) implements Effect {}

  /** Reputation with {@code faction} changed by {@code delta} to {@code total}. */
  record ReputationChanged(String faction, long delta, long total) implements Effect {}

  /** Quest points rose by {@code amount} to {@code total}. */
  record PointsGained(long amount, long total) implements Effect {}

  /** A collection entry was revealed by a first eligible pickup. */
  record Discovered(String name) implements Effect {}
}
