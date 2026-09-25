package com.shepherdjerred.thestorm.towns.domain.protection;

/** Who or what a player hurts, pushes or pulls, as seen from that player. */
public sealed interface Victim {

  /** The player themselves: their own arrow, their own potion. */
  record Self() implements Victim {}

  /** Another player. */
  record OtherPlayer() implements Victim {}

  /** A pet the attacker tamed. */
  record OwnPet() implements Victim {}

  /** A pet another player tamed. */
  record OthersPet() implements Victim {}

  /** Something land protection does not cover: hostile mobs, NPCs, items, projectiles. */
  record Unprotected() implements Victim {}

  /** Anything else: animals, villagers, golems, vehicles, item frames, armor stands. */
  record Protected(Subject subject) implements Victim {}
}
