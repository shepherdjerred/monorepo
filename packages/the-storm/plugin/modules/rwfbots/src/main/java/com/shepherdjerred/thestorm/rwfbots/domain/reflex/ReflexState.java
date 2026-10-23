package com.shepherdjerred.thestorm.rwfbots.domain.reflex;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.Facing;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import java.util.Optional;

/**
 * Everything the reflex layer carries from tick to tick. Ticks of -1 mean "not happening".
 *
 * @param aim where the bot looks and its aim noise
 * @param nextClickAt the earliest tick (fractional) the next melee click may happen
 * @param wTapUntil sprint stays off until this tick after a landed hit
 * @param strafeDir +1 or -1, which way the bot circles
 * @param nextStrafeFlip when the strafe direction next flips
 * @param drawStart when the bow draw started, or -1
 * @param eatingSince when eating started, or -1
 * @param healing whether the bot keeps eating until the upper health threshold
 * @param nextFuseClick the earliest tick of the next fuse click
 * @param waypointIndex the waypoint being walked to in the current decision
 * @param decisionTick the snapshot tick of the decision the waypoint index belongs to
 * @param lastJumpTick when the bot last jumped
 * @param abilityUsedFor the decision tick whose ability has already been triggered, or -1
 * @param nextKitUse the earliest tick a kit item may be used again
 * @param activeJump the jump being prepared or flown, if any
 * @param bowSight where the drawn bow last had a target, so a draw survives the target ducking out
 *     of sight
 */
public record ReflexState(
    AimState aim,
    double nextClickAt,
    long wTapUntil,
    int strafeDir,
    long nextStrafeFlip,
    long drawStart,
    long eatingSince,
    boolean healing,
    long nextFuseClick,
    int waypointIndex,
    long decisionTick,
    long lastJumpTick,
    long abilityUsedFor,
    long nextKitUse,
    Optional<ActiveJump> activeJump,
    Optional<ReflexState.BowSight> bowSight) {

  public ReflexState {
    if (strafeDir != 1 && strafeDir != -1) {
      throw new IllegalArgumentException("strafe direction must be +1 or -1");
    }
    if (waypointIndex < 0) {
      throw new IllegalArgumentException("waypoint index must not be negative");
    }
  }

  /** A fresh life looking along {@code look}. */
  public static ReflexState initial(Facing look) {
    return new ReflexState(
        AimState.looking(look),
        0,
        -1,
        1,
        0,
        -1,
        -1,
        false,
        0,
        0,
        -1,
        -1,
        -1,
        0,
        Optional.empty(),
        Optional.empty());
  }

  public boolean isDrawing() {
    return drawStart >= 0;
  }

  public boolean isEating() {
    return eatingSince >= 0;
  }

  public ReflexState withAim(AimState newAim) {
    return new ReflexState(
        newAim,
        nextClickAt,
        wTapUntil,
        strafeDir,
        nextStrafeFlip,
        drawStart,
        eatingSince,
        healing,
        nextFuseClick,
        waypointIndex,
        decisionTick,
        lastJumpTick,
        abilityUsedFor,
        nextKitUse,
        activeJump,
        bowSight);
  }

  public ReflexState withClick(double newNextClickAt, long newWTapUntil) {
    return new ReflexState(
        aim,
        newNextClickAt,
        newWTapUntil,
        strafeDir,
        nextStrafeFlip,
        drawStart,
        eatingSince,
        healing,
        nextFuseClick,
        waypointIndex,
        decisionTick,
        lastJumpTick,
        abilityUsedFor,
        nextKitUse,
        activeJump,
        bowSight);
  }

  public ReflexState withStrafe(int newDir, long newFlip) {
    return new ReflexState(
        aim,
        nextClickAt,
        wTapUntil,
        newDir,
        newFlip,
        drawStart,
        eatingSince,
        healing,
        nextFuseClick,
        waypointIndex,
        decisionTick,
        lastJumpTick,
        abilityUsedFor,
        nextKitUse,
        activeJump,
        bowSight);
  }

  public ReflexState withDrawStart(long tick) {
    return new ReflexState(
        aim,
        nextClickAt,
        wTapUntil,
        strafeDir,
        nextStrafeFlip,
        tick,
        eatingSince,
        healing,
        nextFuseClick,
        waypointIndex,
        decisionTick,
        lastJumpTick,
        abilityUsedFor,
        nextKitUse,
        activeJump,
        bowSight);
  }

  public ReflexState withEating(long since, boolean nowHealing) {
    return new ReflexState(
        aim,
        nextClickAt,
        wTapUntil,
        strafeDir,
        nextStrafeFlip,
        drawStart,
        since,
        nowHealing,
        nextFuseClick,
        waypointIndex,
        decisionTick,
        lastJumpTick,
        abilityUsedFor,
        nextKitUse,
        activeJump,
        bowSight);
  }

  public ReflexState withNextFuseClick(long tick) {
    return new ReflexState(
        aim,
        nextClickAt,
        wTapUntil,
        strafeDir,
        nextStrafeFlip,
        drawStart,
        eatingSince,
        healing,
        tick,
        waypointIndex,
        decisionTick,
        lastJumpTick,
        abilityUsedFor,
        nextKitUse,
        activeJump,
        bowSight);
  }

  public ReflexState withPath(int index, long forDecisionTick) {
    return new ReflexState(
        aim,
        nextClickAt,
        wTapUntil,
        strafeDir,
        nextStrafeFlip,
        drawStart,
        eatingSince,
        healing,
        nextFuseClick,
        index,
        forDecisionTick,
        lastJumpTick,
        abilityUsedFor,
        nextKitUse,
        activeJump,
        bowSight);
  }

  public ReflexState withLastJump(long tick) {
    return new ReflexState(
        aim,
        nextClickAt,
        wTapUntil,
        strafeDir,
        nextStrafeFlip,
        drawStart,
        eatingSince,
        healing,
        nextFuseClick,
        waypointIndex,
        decisionTick,
        tick,
        abilityUsedFor,
        nextKitUse,
        activeJump,
        bowSight);
  }

  public ReflexState withAbilityUsedFor(long tick) {
    return new ReflexState(
        aim,
        nextClickAt,
        wTapUntil,
        strafeDir,
        nextStrafeFlip,
        drawStart,
        eatingSince,
        healing,
        nextFuseClick,
        waypointIndex,
        decisionTick,
        lastJumpTick,
        tick,
        nextKitUse,
        activeJump,
        bowSight);
  }

  public ReflexState withNextKitUse(long tick) {
    return new ReflexState(
        aim,
        nextClickAt,
        wTapUntil,
        strafeDir,
        nextStrafeFlip,
        drawStart,
        eatingSince,
        healing,
        nextFuseClick,
        waypointIndex,
        decisionTick,
        lastJumpTick,
        abilityUsedFor,
        tick,
        activeJump,
        bowSight);
  }

  public ReflexState withActiveJump(Optional<ActiveJump> jump) {
    return new ReflexState(
        aim,
        nextClickAt,
        wTapUntil,
        strafeDir,
        nextStrafeFlip,
        drawStart,
        eatingSince,
        healing,
        nextFuseClick,
        waypointIndex,
        decisionTick,
        lastJumpTick,
        abilityUsedFor,
        nextKitUse,
        jump,
        bowSight);
  }

  public ReflexState withBowSight(Optional<BowSight> sight) {
    return new ReflexState(
        aim,
        nextClickAt,
        wTapUntil,
        strafeDir,
        nextStrafeFlip,
        drawStart,
        eatingSince,
        healing,
        nextFuseClick,
        waypointIndex,
        decisionTick,
        lastJumpTick,
        abilityUsedFor,
        nextKitUse,
        activeJump,
        sight);
  }

  /**
   * The last time a drawn bow had a target.
   *
   * @param point the aim point then, lead included
   * @param seen the last tick the target was in sight
   * @param since the first tick of that unbroken sighting
   */
  public record BowSight(Vec3 point, long seen, long since) {}
}
