package com.shepherdjerred.thestorm.rwf.domain.ability;

import com.shepherdjerred.thestorm.rwf.domain.geometry.Vec3;

/**
 * How a living combatant stands and moves this tick, as the server reports it.
 *
 * @param position their feet
 * @param velocity blocks per tick
 * @param yaw where they face, in degrees
 * @param pitch how far up or down they look, in degrees
 * @param sneaking whether they sneak
 * @param sprinting whether they sprint
 * @param onGround whether they stand on something
 * @param health their health
 * @param maxHealth their max health
 * @param blocked whether something solid stood in the way of their last horizontal move
 * @param drawingBow whether they are drawing a bow
 * @param safe whether where they stand is a safe place to be sent back to, as Red Warfare's {@code
 *     UtilLoc.isSafeTeleport} decided (see {@code SafeTeleport})
 */
public record Motion(
    Vec3 position,
    Vec3 velocity,
    double yaw,
    double pitch,
    boolean sneaking,
    boolean sprinting,
    boolean onGround,
    double health,
    double maxHealth,
    boolean blocked,
    boolean drawingBow,
    boolean safe) {

  /** Horizontal speed in blocks per tick. */
  public double horizontalSpeed() {
    return Math.hypot(velocity.x(), velocity.z());
  }
}
