package com.shepherdjerred.castlecasters.engine.scene.position;

import com.shepherdjerred.castlecasters.engine.object.SceneObjectDimensions;
import com.shepherdjerred.castlecasters.engine.scene.SceneCoordinate;
import com.shepherdjerred.castlecasters.engine.window.WindowSize;
import lombok.Getter;
import lombok.Setter;

public class BackgroundScenePositioner implements ScenePositioner {

  private final int z = -1000;
  @Getter
  @Setter
  private SceneCoordinateOffset offset;

  @Override
  public SceneCoordinate getSceneCoordinate(WindowSize windowSize,
                                            SceneObjectDimensions sceneObjectDimensions) {
    return new SceneCoordinate(0, 0, z);
  }
}
