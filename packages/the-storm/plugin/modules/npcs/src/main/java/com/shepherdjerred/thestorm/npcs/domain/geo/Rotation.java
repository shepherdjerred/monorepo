package com.shepherdjerred.thestorm.npcs.domain.geo;

/**
 * A facing in Minecraft's convention: yaw 0 faces south (+Z) and grows clockwise seen from above
 * (90 faces west), pitch -90 looks straight up and 90 straight down.
 */
public record Rotation(float yaw, float pitch) {

  /** Facing south, level. */
  public static final Rotation SOUTH = new Rotation(0, 0);

  public Rotation {
    if (!Float.isFinite(yaw)) {
      throw new IllegalArgumentException("yaw must be finite: " + yaw);
    }
    if (!(pitch >= -90 && pitch <= 90)) {
      throw new IllegalArgumentException("pitch must be -90..90: " + pitch);
    }
    // Adding zero turns -0.0 into 0.0, so equal facings are equal records.
    yaw = wrap(yaw) + 0.0f;
    pitch = pitch + 0.0f;
  }

  /**
   * The level facing from {@code from} towards {@code to}, or {@code fallback} if they share x/z.
   */
  public static Rotation heading(Vec3 from, Vec3 to, Rotation fallback) {
    var dx = to.x() - from.x();
    var dz = to.z() - from.z();
    if (Math.abs(dx) < 1.0e-6 && Math.abs(dz) < 1.0e-6) {
      return fallback;
    }
    return new Rotation((float) Math.toDegrees(Math.atan2(-dx, dz)), 0);
  }

  /** The facing of eyes at {@code from} looking at {@code to}. */
  public static Rotation looking(Vec3 from, Vec3 to) {
    var dx = to.x() - from.x();
    var dy = to.y() - from.y();
    var dz = to.z() - from.z();
    var horizontal = Math.sqrt(dx * dx + dz * dz);
    var yaw = horizontal < 1.0e-6 ? 0 : (float) Math.toDegrees(Math.atan2(-dx, dz));
    var pitch = (float) -Math.toDegrees(Math.atan2(dy, horizontal));
    return new Rotation(yaw, Math.clamp(pitch, -90, 90));
  }

  /** The largest of the yaw and pitch differences, in degrees, taking the short way round. */
  public float differenceTo(Rotation other) {
    var yawDelta = Math.abs(wrap(other.yaw - yaw));
    return Math.max(yawDelta, Math.abs(other.pitch - pitch));
  }

  /** Normalizes an angle into [-180, 180). */
  static float wrap(float degrees) {
    var wrapped = degrees % 360;
    if (wrapped >= 180) {
      wrapped -= 360;
    } else if (wrapped < -180) {
      wrapped += 360;
    }
    return wrapped;
  }
}
