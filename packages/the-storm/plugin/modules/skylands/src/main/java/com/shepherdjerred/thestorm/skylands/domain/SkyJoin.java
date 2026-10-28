package com.shepherdjerred.thestorm.skylands.domain;

/** A native jigsaw socket, expressed entirely in template-local coordinates. */
public record SkyJoin(
    SkyPosition position, SkyPosition direction, String name, String target, String pool) {
  public SkyJoin {
    if (Math.abs(direction.x()) + Math.abs(direction.y()) + Math.abs(direction.z()) != 1)
      throw new IllegalArgumentException("A socket must face one block direction");
  }
}
