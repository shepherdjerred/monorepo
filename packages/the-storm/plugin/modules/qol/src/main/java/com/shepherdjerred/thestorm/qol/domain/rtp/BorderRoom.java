package com.shepherdjerred.thestorm.qol.domain.rtp;

/** How far from spawn a landing can sit and still fall inside the world border. */
public final class BorderRoom {

  private BorderRoom() {}

  /**
   * The greatest distance from {@code spawn} that remains {@code margin} blocks inside a border of
   * {@code diameter} centered on {@code center}.
   */
  public static int maxRadius(BlockPoint spawn, BlockPoint center, int diameter, int margin) {
    if (diameter < 2 || margin < 0) {
      throw new IllegalArgumentException("diameter " + diameter + " margin " + margin);
    }
    var radius = diameter / 2 - margin;
    return Math.max(0, radius - spawn.distanceTo(center));
  }
}
