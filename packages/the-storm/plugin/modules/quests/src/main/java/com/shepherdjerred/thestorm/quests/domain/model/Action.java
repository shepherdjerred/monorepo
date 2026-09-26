package com.shepherdjerred.thestorm.quests.domain.model;

import java.util.Optional;

/**
 * Something a quest does: on accepting, when a stage completes, or as a reward. State actions
 * (variables, reputation, points, starting quests) change the player's quest state directly; world
 * actions are carried out by the server.
 */
public sealed interface Action {

  /** Gives items; what does not fit is dropped at the player's feet. */
  record Give(ItemMatch item, int amount) implements Action {
    public Give {
      if (amount < 1) {
        throw new IllegalArgumentException("give at least one item");
      }
    }
  }

  /** Takes up to {@code amount} matching items. */
  record Take(ItemMatch item, int amount) implements Action {
    public Take {
      if (amount < 1) {
        throw new IllegalArgumentException("take at least one item");
      }
    }
  }

  /** Pays crystals from the server account. */
  record Crystals(long amount) implements Action {
    public Crystals {
      if (amount < 1) {
        throw new IllegalArgumentException("pay at least one crystal");
      }
    }
  }

  /** Grants a permission node through LuckPerms. */
  record Grant(String permission) implements Action {}

  /** Grants title {@code id} (the permission {@code thestorm.titles.<id>}). */
  record Title(String id) implements Action {}

  /** Teaches spell {@code id} (the permission {@code thestorm.spells.learned.<id>}). */
  record Spell(String id) implements Action {}

  /** Sets a variable. */
  record SetVariable(String variable, long value) implements Action {}

  /** Adds to a variable (negative subtracts). */
  record AddVariable(String variable, long delta) implements Action {}

  /** Changes reputation with a faction. */
  record Reputation(String faction, long delta) implements Action {}

  /** Adds quest points. */
  record Points(long amount) implements Action {}

  /** Starts another quest, if it could be accepted. */
  record StartQuest(String quest) implements Action {}

  /** Sends the player a line of text. */
  record Message(String text) implements Action {}

  /** Teleports the player to a region's centre, if protection allows arriving there. */
  record Teleport(String region) implements Action {}

  /** Spawns creatures at a region's centre that despawn after a while. */
  record Spawn(String entity, int count, String region, Optional<String> name) implements Action {
    public Spawn {
      if (count < 1) {
        throw new IllegalArgumentException("spawn at least one creature");
      }
    }
  }

  /** Shows a marker above an NPC to the player until it next changes. */
  record Marker(String npc, NpcMark mark) implements Action {}

  /** Runs an action another module registered through {@code QuestHooks}. */
  record Custom(String hook, String argument) implements Action {}

  /** A marker above an NPC. */
  enum NpcMark {
    NONE,
    AVAILABLE,
    TURN_IN
  }
}
