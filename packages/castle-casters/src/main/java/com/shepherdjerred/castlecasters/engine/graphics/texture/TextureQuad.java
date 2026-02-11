package com.shepherdjerred.castlecasters.engine.graphics.texture;

/**
 * A 2D texture quad.
 */
public record TextureQuad(TextureCoordinate topRight, TextureCoordinate topLeft, TextureCoordinate bottomLeft,
                          TextureCoordinate bottomRight) {

  /**
   * Converts this object to an array of floats. Coordinates are in the following order: Bottom
   * left, top left, bottom right, top right.
   */
  public float[] toFloatArray() {
    return new float[]{
        bottomLeft.x(), bottomLeft.y(),
        topLeft.x(), topLeft.y(),
        bottomRight.x(), bottomRight.y(),
        topRight.x(), topRight.y()
    };
  }
}
