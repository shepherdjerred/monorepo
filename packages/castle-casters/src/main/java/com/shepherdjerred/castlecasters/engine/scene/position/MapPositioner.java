package com.shepherdjerred.castlecasters.engine.scene.position;

import com.shepherdjerred.castlecasters.engine.object.SceneObjectDimensions;
import com.shepherdjerred.castlecasters.engine.scene.SceneCoordinate;
import com.shepherdjerred.castlecasters.engine.window.WindowSize;
import lombok.Getter;
import lombok.Setter;

@Setter
@Getter
public class MapPositioner implements ScenePositioner {

  private SceneCoordinateOffset offset;

  @Override
  public SceneCoordinate getSceneCoordinate(WindowSize windowSize,
                                            SceneObjectDimensions sceneObjectDimensions) {
    return null;
  }

}
