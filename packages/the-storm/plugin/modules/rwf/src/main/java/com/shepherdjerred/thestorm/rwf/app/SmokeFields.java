package com.shepherdjerred.thestorm.rwf.app;

import com.shepherdjerred.thestorm.rwf.app.view.Point;
import java.time.Instant;
import java.util.Collection;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/** Analytic segment/sphere occlusion; endpoints inside smoke are obscured too. */
public final class SmokeFields implements VisualOcclusion {
  public record Field(UUID owner, Point center, double radius, Instant until) {
    public Field {
      if (!(radius > 0) || !Double.isFinite(radius))
        throw new IllegalArgumentException("smoke needs a finite positive radius");
    }
  }

  private final Map<UUID, Field> fields = new HashMap<>();

  public void add(Field field) {
    fields.put(field.owner(), field);
  }

  public void remove(UUID owner) {
    fields.remove(owner);
  }

  public void clear() {
    fields.clear();
  }

  public boolean active() {
    return !fields.isEmpty();
  }

  public Collection<Field> fields() {
    return List.copyOf(fields.values());
  }

  @Override
  public List<VisualOcclusion.Field> snapshot() {
    return fields.values().stream()
        .map(field -> new VisualOcclusion.Field(field.center(), field.radius()))
        .sorted(
            java.util.Comparator.comparingDouble(
                    (VisualOcclusion.Field field) -> field.center().x())
                .thenComparingDouble(field -> field.center().y())
                .thenComparingDouble(field -> field.center().z()))
        .toList();
  }

  public void expire(Instant now) {
    fields.values().removeIf(field -> !now.isBefore(field.until()));
  }

  @Override
  public boolean obscured(Point from, Point to) {
    return fields.values().stream().anyMatch(field -> intersects(from, to, field));
  }

  private static boolean intersects(Point from, Point to, Field field) {
    var dx = to.x() - from.x();
    var dy = to.y() - from.y();
    var dz = to.z() - from.z();
    var cx = field.center().x() - from.x();
    var cy = field.center().y() - from.y();
    var cz = field.center().z() - from.z();
    var length = dx * dx + dy * dy + dz * dz;
    var fraction = length == 0 ? 0 : Math.clamp((cx * dx + cy * dy + cz * dz) / length, 0, 1);
    var x = cx - fraction * dx;
    var y = cy - fraction * dy;
    var z = cz - fraction * dz;
    return x * x + y * y + z * z <= field.radius() * field.radius();
  }
}
