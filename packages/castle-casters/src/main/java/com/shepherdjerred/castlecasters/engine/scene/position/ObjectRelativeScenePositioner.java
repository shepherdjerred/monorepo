package com.shepherdjerred.castlecasters.engine.scene.position;

import com.shepherdjerred.castlecasters.engine.object.GameObject;
import com.shepherdjerred.castlecasters.engine.object.SceneObjectDimensions;
import com.shepherdjerred.castlecasters.engine.scene.SceneCoordinate;
import com.shepherdjerred.castlecasters.engine.scene.position.WindowRelativeScenePositioner.HorizontalPosition;
import com.shepherdjerred.castlecasters.engine.scene.position.WindowRelativeScenePositioner.VerticalPosition;
import com.shepherdjerred.castlecasters.engine.window.WindowSize;
import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.Setter;
import lombok.ToString;
import lombok.extern.log4j.Log4j2;

@Log4j2
@ToString
@AllArgsConstructor
public class ObjectRelativeScenePositioner implements ScenePositioner {

  private final GameObject anchor;
  @Getter
  @Setter
  private SceneCoordinateOffset offset;
  private final int z;

  @Override
  public SceneCoordinate getSceneCoordinate(WindowSize windowSize,
                                            SceneObjectDimensions dimensions) {
    var x = getXCoordinate(windowSize, dimensions);
    var y = getYCoordinate(windowSize, dimensions);

    return new SceneCoordinate(x, y, z);
  }

  private float getXCoordinate(WindowSize windowSize, SceneObjectDimensions dimensions) {
    var anchorPosition = anchor.getPosition();
    var anchorX = anchor.getPosition().getSceneCoordinate(windowSize, dimensions).x();
    var anchorWidth = anchor.getSceneObjectDimensions().width();
    var objectWidth = dimensions.width();

    int diff = 0;

    if (anchorPosition instanceof WindowRelativeScenePositioner anchorWindowPositioner) {
      var horizontalPosition = anchorWindowPositioner.getHorizontalPosition();
      if (horizontalPosition == HorizontalPosition.LEFT) {
        diff = Math.abs(anchorWidth - objectWidth);
      } else if (horizontalPosition == HorizontalPosition.RIGHT) {
        diff = Math.abs(anchorWidth - objectWidth) * -1;
      }
    }

    diff /= 2;

    return anchorX + diff + offset.getXOffset();
  }

  private float getYCoordinate(WindowSize windowSize, SceneObjectDimensions dimensions) {
    var anchorPosition = anchor.getPosition();
    var anchorY = anchor.getPosition().getSceneCoordinate(windowSize, dimensions).y();
    var anchorHeight = anchor.getSceneObjectDimensions().height();
    var objectHeight = dimensions.height();

    int diff = 0;

    if (anchorPosition instanceof WindowRelativeScenePositioner anchorWindowPositioner) {
      var verticalPosition = anchorWindowPositioner.getVerticalPosition();
      if (verticalPosition == VerticalPosition.TOP) {
        diff = Math.abs(anchorHeight - objectHeight);
      } else if (verticalPosition == VerticalPosition.BOTTOM) {
        diff = Math.abs(anchorHeight - objectHeight) * -1;
      }
    }

    diff /= 2;

    return anchorY + diff + offset.getYOffset();
  }
}
