package com.shepherdjerred.thestorm.skylands.domain;

/** A seeded, terrain-fitted instance of a reusable native piece. */
public record SkyPiece(SkyTemplate template, SkyPosition origin, int quarterTurns) {
  public SkyPiece {
    if (quarterTurns < 0 || quarterTurns > 3)
      throw new IllegalArgumentException("Invalid rotation");
  }

  public SkyPosition at(SkyPosition relative) {
    int x = relative.x(), y = relative.y(), z = relative.z();
    var size = template.size();
    var rotated =
        switch (quarterTurns) {
          case 0 -> relative;
          case 1 -> new SkyPosition(size.z() - 1 - z, y, x);
          case 2 -> new SkyPosition(size.x() - 1 - x, y, size.z() - 1 - z);
          case 3 -> new SkyPosition(z, y, size.x() - 1 - x);
          default -> throw new IllegalStateException("Validated rotation changed");
        };
    return origin.add(rotated);
  }

  public SkyPosition entrance() {
    return at(template.entrance());
  }

  public SkyPosition direction(SkyPosition vector) {
    return switch (quarterTurns) {
      case 0 -> vector;
      case 1 -> new SkyPosition(-vector.z(), vector.y(), vector.x());
      case 2 -> new SkyPosition(-vector.x(), vector.y(), -vector.z());
      case 3 -> new SkyPosition(vector.z(), vector.y(), -vector.x());
      default -> throw new IllegalStateException("Validated rotation changed");
    };
  }

  public SkyPosition size() {
    var s = template.size();
    return quarterTurns % 2 == 0 ? s : new SkyPosition(s.z(), s.y(), s.x());
  }

  public SkyBounds bounds() {
    return new SkyBounds(origin.above(-3), origin.add(size()).add(new SkyPosition(-1, 1, -1)));
  }

  public boolean overlaps(SkyPiece other) {
    return bounds().expanded(3).intersects(other.bounds());
  }
}
