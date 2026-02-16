package com.shepherdjerred.castlecasters.engine.scene.position;

import com.shepherdjerred.castlecasters.engine.map.MapCoordinate;
import com.shepherdjerred.castlecasters.engine.object.SceneObjectDimensions;
import com.shepherdjerred.castlecasters.engine.scene.SceneCoordinate;
import com.shepherdjerred.castlecasters.engine.window.WindowSize;
import com.shepherdjerred.castlecasters.game.Constants;
import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.Setter;

@AllArgsConstructor
public class MapCoordinateScenePositioner implements ScenePositioner {

  @Getter
  @Setter
  private SceneCoordinateOffset offset;
  @Getter
  @Setter
  private MapCoordinate mapCoordinate;
  private final int z;

  @Override
  public SceneCoordinate getSceneCoordinate(WindowSize windowSize,
                                            SceneObjectDimensions sceneObjectDimensions) {
    var tileSize = Constants.RENDER_TILE_RESOLUTION;
    var x = mapCoordinate.x() * tileSize;
    var y = mapCoordinate.y() * tileSize;
    return new SceneCoordinate(x, y, z);
  }
}
