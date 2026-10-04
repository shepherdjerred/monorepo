package com.shepherdjerred.thestorm.rwfbots.domain.geom;

/**
 * A look direction in Minecraft's convention: yaw 0 faces south (+Z) and grows clockwise seen from
 * above (90 faces west, -X), pitch -90 looks straight up and 90 straight down.
 */
public record Facing(double yaw, double pitch) {

  public static final Facing SOUTH = new Facing(0, 0);

  public Facing {
    if (!Double.isFinite(yaw)) {
      throw new IllegalArgumentException("yaw must be finite: " + yaw);
    }
    if (!(pitch >= -90 && pitch <= 90)) {
      throw new IllegalArgumentException("pitch must be -90..90: " + pitch);
    }
    // Adding zero turns -0.0 into 0.0, so equal facings are equal records.
    yaw = wrap(yaw) + 0.0;
    pitch = pitch + 0.0;
  }

  /** The unit direction this facing looks along. */
  public Vec3 direction() {
    var yawRad = Math.toRadians(yaw);
    var pitchRad = Math.toRadians(pitch);
    var cosPitch = Math.cos(pitchRad);
    return new Vec3(-Math.sin(yawRad) * cosPitch, -Math.sin(pitchRad), Math.cos(yawRad) * cosPitch);
  }

  /** The facing that looks along {@code direction}, which must be non-zero. */
  public static Facing of(Vec3 direction) {
    var horizontal = Math.sqrt(direction.x() * direction.x() + direction.z() * direction.z());
    if (horizontal < 1.0e-9 && Math.abs(direction.y()) < 1.0e-9) {
      throw new IllegalArgumentException("a zero direction has no facing");
    }
    var yaw = horizontal < 1.0e-9 ? 0 : Math.toDegrees(Math.atan2(-direction.x(), direction.z()));
    var pitch = -Math.toDegrees(Math.atan2(direction.y(), horizontal));
    return new Facing(yaw, Math.clamp(pitch, -90, 90));
  }

  /** The facing of eyes at {@code from} looking at {@code to}. */
  public static Facing looking(Vec3 from, Vec3 to) {
    return of(to.minus(from));
  }

  /** The signed yaw change from this to {@code other}, the short way round, in (-180, 180]. */
  public double yawDelta(Facing other) {
    return wrap(other.yaw - yaw);
  }

  /** The largest of the yaw and pitch differences, in degrees, taking the short way round. */
  public double differenceTo(Facing other) {
    return Math.max(Math.abs(yawDelta(other)), Math.abs(other.pitch - pitch));
  }

  /** The angle between the two look directions, in degrees. */
  public double angleTo(Facing other) {
    return direction().angleTo(other.direction());
  }

  /**
   * This facing turned towards {@code target} by at most {@code maxDegrees} on each axis, the short
   * way round.
   */
  public Facing turnToward(Facing target, double maxDegrees) {
    if (maxDegrees < 0) {
      throw new IllegalArgumentException("maxDegrees must not be negative: " + maxDegrees);
    }
    var dYaw = Math.clamp(yawDelta(target), -maxDegrees, maxDegrees);
    var dPitch = Math.clamp(target.pitch - pitch, -maxDegrees, maxDegrees);
    return new Facing(yaw + dYaw, pitch + dPitch);
  }

  /** This facing with {@code dYaw} and {@code dPitch} added; pitch is clamped to its range. */
  public Facing plus(double dYaw, double dPitch) {
    return new Facing(yaw + dYaw, Math.clamp(pitch + dPitch, -90, 90));
  }

  /** Normalizes an angle into [-180, 180). */
  public static double wrap(double degrees) {
    var wrapped = degrees % 360;
    if (wrapped >= 180) {
      wrapped -= 360;
    } else if (wrapped < -180) {
      wrapped += 360;
    }
    return wrapped;
  }
}
