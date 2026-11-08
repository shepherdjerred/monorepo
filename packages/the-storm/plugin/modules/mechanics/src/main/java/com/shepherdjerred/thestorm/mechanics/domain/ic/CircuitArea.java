package com.shepherdjerred.thestorm.mechanics.domain.ic;

import com.shepherdjerred.thestorm.mechanics.domain.grid.Direction;
import com.shepherdjerred.thestorm.mechanics.domain.grid.Pos;
import java.util.random.RandomGenerator;

/** CraftBook radius[,radius,radius][=offset] areas, centered on the sign's support block. */
public record CircuitArea(Pos center, Pos radius) {
  public static CircuitArea parse(String text, Pos support, Direction front) {
    if (text.startsWith("r:"))
      throw new IllegalArgumentException(
          "external WorldGuard region must be restored or rewritten as explicit coordinates");
    var parts = text.strip().split("=", -1);
    if (parts.length > 2) throw new IllegalArgumentException("area has too many offsets");
    var radii = vector(parts[0], ",", true);
    var center = support;
    if (parts.length == 2) {
      var offset = parts[1];
      var absolute = offset.contains("!");
      var worldOffset = offset.contains("&");
      var value = vector(offset.replace("!", "").replace("&", "").replace("^", ""), ":", false);
      if (absolute) center = value;
      else if (worldOffset)
        center = new Pos(support.x() + value.x(), support.y() + value.y(), support.z() + value.z());
      else {
        var right = front.clockwise();
        center =
            new Pos(
                support.x() + right.dx() * value.x() + front.dx() * value.z(),
                support.y() + value.y(),
                support.z() + right.dz() * value.x() + front.dz() * value.z());
      }
    }
    return new CircuitArea(center, radii);
  }

  private static Pos vector(String text, String separator, boolean radius) {
    var fields = text.split(separator, -1);
    if (fields.length != 1 && fields.length != 3)
      throw new IllegalArgumentException("area vector needs one or three numbers");
    if (fields.length == 1) {
      var value = coordinate(fields[0], radius);
      return radius ? new Pos(value, value, value) : new Pos(0, value, 0);
    }
    return new Pos(
        coordinate(fields[0], radius),
        coordinate(fields[1], radius),
        coordinate(fields[2], radius));
  }

  private static int coordinate(String text, boolean radius) {
    var value = Double.parseDouble(text);
    if (!Double.isFinite(value)
        || (radius ? value < 0 || value > 500 : Math.abs(value) > 30_000_000)) {
      throw new IllegalArgumentException(
          "area radius must be 0..500 and offsets must be finite world coordinates");
    }
    return (int) Math.floor(value);
  }

  public Pos sample(RandomGenerator random) {
    return new Pos(
        center.x() + random.nextInt(-radius.x(), radius.x() + 1),
        center.y() + random.nextInt(-radius.y(), radius.y() + 1),
        center.z() + random.nextInt(-radius.z(), radius.z() + 1));
  }
}
