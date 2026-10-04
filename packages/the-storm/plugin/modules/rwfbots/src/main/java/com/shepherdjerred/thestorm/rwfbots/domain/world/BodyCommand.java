package com.shepherdjerred.thestorm.rwfbots.domain.world;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;

/** What a bot's body is told to do this tick. The adapter applies them in order. */
public sealed interface BodyCommand {

  /** Set the look direction. */
  record Look(double yaw, double pitch) implements BodyCommand {}

  /** Walk or sprint towards {@code waypoint} this tick. */
  record MoveToward(Vec3 waypoint, boolean sprint) implements BodyCommand {}

  /** Stop moving. */
  record Stop() implements BodyCommand {}

  /** Jump if on the ground. */
  record Jump() implements BodyCommand {}

  /** Start or stop sneaking. */
  record Sneak(boolean sneaking) implements BodyCommand {}

  /** Select hotbar slot 0..8. */
  record SelectSlot(int slot) implements BodyCommand {

    public SelectSlot {
      if (slot < 0 || slot > 8) {
        throw new IllegalArgumentException("slot must be 0..8: " + slot);
      }
    }
  }

  /** Swing the arm without hitting anything. */
  record Swing() implements BodyCommand {}

  /** Attack {@code target}, who the look ray hits. */
  record Attack(CombatantId target) implements BodyCommand {}

  /** Start holding right click: draw a bow, start eating. */
  record StartUse() implements BodyCommand {}

  /** Release right click: fire a bow, stop eating. */
  record ReleaseUse() implements BodyCommand {}

  /** Right click {@code bomb} with the fuse. */
  record ClickBomb(BombId bomb) implements BodyCommand {}

  /** Trigger a kit ability by name, such as {@code rewind}. */
  record UseAbility(String name) implements BodyCommand {

    public UseAbility {
      if (name.isBlank()) {
        throw new IllegalArgumentException("ability name must not be blank");
      }
    }
  }
}
