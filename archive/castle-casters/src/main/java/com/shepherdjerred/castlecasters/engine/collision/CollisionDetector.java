package com.shepherdjerred.castlecasters.engine.collision;

import com.shepherdjerred.castlecasters.engine.scene.SceneCoordinate;

public interface CollisionDetector {

  boolean hasCollision(SceneCoordinate sceneCoordinate);
}
