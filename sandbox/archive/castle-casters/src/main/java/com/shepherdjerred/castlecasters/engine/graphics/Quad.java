package com.shepherdjerred.castlecasters.engine.graphics;

/**
 * A 3D quad.
 */
public record Quad(RendererCoordinate topRight, RendererCoordinate topLeft, RendererCoordinate bottomLeft,
                   RendererCoordinate bottomRight) {

  /**
   * Converts this object to an array of floats. Coordinates are in the following order: Bottom
   * left, top left, bottom right, top right.
   */
  public float[] toFloatArray() {
    return new float[]{
        bottomLeft.getX(), bottomLeft.getY(), bottomLeft.getZ(),
        topLeft.getX(), topLeft.getY(), topLeft.getZ(),
        bottomRight.getX(), bottomRight.getY(), bottomRight.getZ(),
        topRight.getX(), topRight.getY(), topRight.getZ()
    };
  }
}
