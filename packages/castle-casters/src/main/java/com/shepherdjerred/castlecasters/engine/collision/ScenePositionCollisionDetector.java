package com.shepherdjerred.castlecasters.engine.collision;

import com.shepherdjerred.castlecasters.engine.object.SceneObjectDimensions;
import com.shepherdjerred.castlecasters.engine.scene.SceneCoordinate;
import com.shepherdjerred.castlecasters.engine.scene.position.ScenePositioner;
import com.shepherdjerred.castlecasters.engine.window.WindowSize;
import lombok.AllArgsConstructor;
import lombok.Setter;

/**
 * Determines if there is a collision based on a ScenePositioner. Useful for game objects.
 */
@Setter
@AllArgsConstructor
public class ScenePositionCollisionDetector implements CollisionDetector {

  private ScenePositioner scenePositioner;
  private WindowSize windowSize;
  private SceneObjectDimensions dimensions;

  @Override
  public boolean hasCollision(SceneCoordinate coordinate) {
    var position = scenePositioner.getSceneCoordinate(windowSize, dimensions);
    var maxX = position.x() + dimensions.width();
    var minX = position.x();
    var maxY = position.y() + dimensions.height();
    var minY = position.y();

    return coordinate.x() <= maxX
        && coordinate.x() >= minX
        && coordinate.y() <= maxY
        && coordinate.y() >= minY;
  }
}
