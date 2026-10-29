package com.shepherdjerred.thestorm.rwfbots.domain.world;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import java.util.Optional;

/** What a bot's body is told to do this tick. The adapter applies them in order. */
public sealed interface BodyCommand {

  /** Set the look direction. */
  record Look(double yaw, double pitch) implements BodyCommand {}

  /** Walk or sprint towards {@code waypoint} this tick. */
  record MoveToward(Vec3 waypoint, boolean sprint, Hop hop) implements BodyCommand {
    public MoveToward(Vec3 waypoint, boolean sprint) {
      this(waypoint, sprint, Hop.WALK);
    }
  }

  /** Stop moving. */
  record Stop() implements BodyCommand {}

  /**
   * Jump if on the ground.
   *
   * @param hop a sprint jump along a straight run, with the inputs a player holds through it
   *     ({@link com.shepherdjerred.thestorm.rwfbots.domain.reflex.MovementMotor#hop}), rather than
   *     a step, leap or fight jump
   */
  record Jump(boolean hop) implements BodyCommand {
    /** A step, leap or fight jump. */
    public Jump() {
      this(false);
    }
  }

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

  /** Let go of right click without firing: a half-drawn bow is lowered, no arrow leaves. */
  record CancelUse() implements BodyCommand {}

  /**
   * Eat what is in hotbar {@code slot} through rwf's consume port, without changing the held item:
   * a steak heals at once.
   */
  record Consume(int slot) implements BodyCommand {

    public Consume {
      if (slot < 0 || slot > 8) {
        throw new IllegalArgumentException("slot must be 0..8: " + slot);
      }
    }
  }

  /** Right click {@code bomb} with the fuse. */
  record ClickBomb(BombId bomb) implements BodyCommand {}

  /**
   * Use the kit item in hotbar {@code slot}: on {@code target} when it is used on someone, looking
   * at {@code at} when it is aimed.
   */
  record UseKit(int slot, Optional<CombatantId> target, Optional<Vec3> at) implements BodyCommand {

    public UseKit {
      if (slot < 0 || slot > 8) {
        throw new IllegalArgumentException("slot must be 0..8: " + slot);
      }
    }
  }

  /** Call in the first killstreak reward carried, on the ground at the bot's feet. */
  record UseStreak() implements BodyCommand {}

  /** Trigger a kit ability by name, such as {@code rewind}. */
  record UseAbility(String name) implements BodyCommand {

    public UseAbility {
      if (name.isBlank()) {
        throw new IllegalArgumentException("ability name must not be blank");
      }
    }
  }
}
