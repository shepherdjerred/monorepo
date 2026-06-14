package com.shepherdjerred.castlecasters.engine.map;

/**
 * The dimensions of a map.
 */
public record MapDimensions(int width, int height) {

  public boolean contains(MapCoordinate mapCoordinate) {
    return mapCoordinate.x() < width && mapCoordinate.y() < height;
  }
}
