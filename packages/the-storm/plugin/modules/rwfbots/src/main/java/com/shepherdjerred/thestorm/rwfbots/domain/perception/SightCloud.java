package com.shepherdjerred.thestorm.rwfbots.domain.perception;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import java.util.List;

/**
 * An immutable smoke sphere captured on the main thread; it affects vision, never sound or paths.
 */
public record SightCloud(Vec3 center, double radius) {
  public SightCloud {
    if (!(radius > 0) || !Double.isFinite(radius))
      throw new IllegalArgumentException("invalid smoke radius");
  }

  public static boolean clear(List<SightCloud> clouds, Vec3 from, Vec3 to) {
    var ray = to.minus(from);
    var length = ray.lengthSquared();
    for (var cloud : clouds) {
      var offset = cloud.center().minus(from);
      var along = length == 0 ? 0 : Math.clamp(offset.dot(ray) / length, 0, 1);
      if (from.plus(ray.scale(along)).distanceSquared(cloud.center())
          <= cloud.radius() * cloud.radius()) return false;
    }
    return true;
  }
}
