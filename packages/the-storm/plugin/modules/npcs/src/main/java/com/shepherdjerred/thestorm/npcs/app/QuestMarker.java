package com.shepherdjerred.thestorm.npcs.app;

/** The marker a player sees above an NPC. */
public enum QuestMarker {
  /** No marker. */
  NONE,
  /** {@code !}: the NPC has a quest for this player. */
  AVAILABLE,
  /** {@code ?}: this player can hand in a quest here. */
  TURN_IN
}
