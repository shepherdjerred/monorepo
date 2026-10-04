package com.shepherdjerred.thestorm.rwf.adapter.content;

import com.shepherdjerred.thestorm.rwf.domain.geometry.Spawn;
import com.shepherdjerred.thestorm.rwf.domain.geometry.Vec3;

/**
 * A position with a facing, as the YAML writes it: {@code {x, y, z, yaw, pitch}}.
 *
 * @param x east
 * @param y up
 * @param z south
 * @param yaw degrees, 0 to 360 exclusive
 * @param pitch degrees, -90 to 90
 */
public record PointEntry(double x, double y, double z, float yaw, float pitch) {

  public PointEntry {
    // Spawn validates the angles and finiteness; building one here surfaces a bad value at its
    // path.
    var _ = new Spawn(new Vec3(x, y, z), yaw, pitch);
  }

  public Spawn toSpawn() {
    return new Spawn(new Vec3(x, y, z), yaw, pitch);
  }
}
