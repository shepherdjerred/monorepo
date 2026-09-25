package com.shepherdjerred.thestorm.spells.domain.geometry;

/** Directions in words, for Divine's "you sense diamond ore 12 blocks north-east, 8 below". */
public final class Compass {

  private static final String[] POINTS = {
    "south", "south-west", "west", "north-west", "north", "north-east", "east", "south-east"
  };

  private Compass() {}

  /** The eight-point compass direction of the horizontal part of {@code delta}. */
  public static String point(Vec3 delta) {
    if (Math.abs(delta.x()) < 0.5 && Math.abs(delta.z()) < 0.5) {
      return "right here";
    }
    // Minecraft yaw: 0 is south (+z), 90 west (-x).
    var yaw = Math.toDegrees(Math.atan2(-delta.x(), delta.z()));
    var normalized = ((yaw % 360) + 360) % 360;
    var index = (int) Math.floor((normalized + 22.5) / 45) % 8;
    return POINTS[index];
  }

  /** A full description of {@code delta}: distance, direction and height. */
  public static String describe(Vec3 delta) {
    var horizontal = Math.round(delta.horizontal().length());
    var vertical = Math.round(delta.y());
    var direction = point(delta);
    var where = horizontal == 0 ? direction : horizontal + " blocks " + direction;
    if (vertical > 0) {
      return where + ", " + vertical + " above";
    }
    if (vertical < 0) {
      return where + ", " + -vertical + " below";
    }
    return where + ", level with you";
  }
}
