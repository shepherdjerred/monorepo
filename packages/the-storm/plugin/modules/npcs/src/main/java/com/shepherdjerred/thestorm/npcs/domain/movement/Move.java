package com.shepherdjerred.thestorm.npcs.domain.movement;

import com.shepherdjerred.thestorm.npcs.domain.geo.Rotation;
import com.shepherdjerred.thestorm.npcs.domain.geo.Vec3;
import com.shepherdjerred.thestorm.npcs.domain.npc.NpcPose;

/** What the adapter should do to the NPC's entity this tick. */
public sealed interface Move {

  /** Walk one step: move to {@code to}, facing {@code facing}. */
  record Step(Vec3 to, Rotation facing) implements Move {}

  /** Jump straight to {@code to}: the NPC is stuck or the navigator found no way. */
  record Teleport(Vec3 to, Rotation facing) implements Move {}

  /** Hold {@code pose} facing {@code facing}, on arriving or setting off. */
  record Settle(Rotation facing, NpcPose pose) implements Move {}

  /** Turn to {@code facing} without moving, such as to look at a nearby player. */
  record Face(Rotation facing) implements Move {}

  /** The path is known or abandoned; the navigator can go. */
  record ReleaseNavigator() implements Move {}
}
