package com.shepherdjerred.castlecasters.engine.scene.position;

import com.shepherdjerred.castlecasters.engine.object.SceneObjectDimensions;
import com.shepherdjerred.castlecasters.engine.scene.SceneCoordinate;
import com.shepherdjerred.castlecasters.engine.window.WindowSize;
import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.Setter;
import lombok.ToString;

@Getter
@ToString
@AllArgsConstructor
public class AbsoluteScenePositioner implements ScenePositioner {

  private final SceneCoordinate sceneCoordinate;
  @Setter
  private SceneCoordinateOffset offset;

  @Override
  public SceneCoordinate getSceneCoordinate(WindowSize windowSize,
                                            SceneObjectDimensions dimensions) {
    return sceneCoordinate.withOffset(offset);
  }
}
