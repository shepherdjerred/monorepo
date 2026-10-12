package com.shepherdjerred.mcbridge.domain;

/** A paste rotation around Y, in degrees, matching WorldEdit's {@code //rotate}. */
public record Rotation(int degrees) {
  public Rotation {
    if (degrees != 0 && degrees != 90 && degrees != 180 && degrees != 270) {
      throw BridgeException.badRequest("rotate must be 0, 90, 180 or 270: " + degrees);
    }
  }
}
