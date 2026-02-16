package com.shepherdjerred.castlecasters.engine.scene;

import com.shepherdjerred.castlecasters.engine.scene.position.SceneCoordinateOffset;

public record SceneCoordinate(float x, float y, float z) {

  public SceneCoordinate withOffset(SceneCoordinateOffset offset) {
    return new SceneCoordinate(x + offset.getXOffset(), y + offset.getYOffset(), z);
  }
}
