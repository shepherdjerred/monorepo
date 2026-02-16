package com.shepherdjerred.castlecasters.engine.scene.position;

import com.shepherdjerred.castlecasters.engine.object.SceneObjectDimensions;
import com.shepherdjerred.castlecasters.engine.scene.SceneCoordinate;
import com.shepherdjerred.castlecasters.engine.window.WindowSize;

public interface ScenePositioner {

  SceneCoordinate getSceneCoordinate(WindowSize windowSize,
                                     SceneObjectDimensions sceneObjectDimensions);

  SceneCoordinateOffset getOffset();

  void setOffset(SceneCoordinateOffset offset);
}
