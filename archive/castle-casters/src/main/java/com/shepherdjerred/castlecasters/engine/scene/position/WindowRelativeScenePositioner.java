package com.shepherdjerred.castlecasters.engine.scene.position;

import com.shepherdjerred.castlecasters.engine.object.SceneObjectDimensions;
import com.shepherdjerred.castlecasters.engine.scene.SceneCoordinate;
import com.shepherdjerred.castlecasters.engine.window.WindowSize;
import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.Setter;
import lombok.ToString;

@ToString
@AllArgsConstructor
public class WindowRelativeScenePositioner implements ScenePositioner {

  @Getter
  private final HorizontalPosition horizontalPosition;
  @Getter
  private final VerticalPosition verticalPosition;
  @Setter
  @Getter
  private SceneCoordinateOffset offset;
  private final float z;

  @Override
  public SceneCoordinate getSceneCoordinate(WindowSize windowSize,
                                            SceneObjectDimensions dimensions) {
    var x = getXCoordinate(windowSize, dimensions.width()) + offset.getXOffset();
    var y = getYCoordinate(windowSize, dimensions.height()) + offset.getYOffset();
    return new SceneCoordinate(x, y, z);
  }

  private float getXCoordinate(WindowSize windowSize, int width) {
    if (horizontalPosition == HorizontalPosition.LEFT) {
      return 0;
    } else if (horizontalPosition == HorizontalPosition.RIGHT) {
      return windowSize.width() - width;
    } else if (horizontalPosition == HorizontalPosition.CENTER) {
      return (windowSize.width() - width) / 2;
    } else {
      throw new UnsupportedOperationException();
    }
  }

  private float getYCoordinate(WindowSize windowSize, int height) {
    if (verticalPosition == VerticalPosition.TOP) {
      return 0;
    } else if (verticalPosition == VerticalPosition.BOTTOM) {
      return windowSize.height() - height;
    } else if (verticalPosition == VerticalPosition.CENTER) {
      return (windowSize.height() - height) / 2;
    } else {
      throw new UnsupportedOperationException();
    }
  }

  public enum HorizontalPosition {
    LEFT, RIGHT, CENTER
  }

  public enum VerticalPosition {
    TOP, BOTTOM, CENTER
  }
}
