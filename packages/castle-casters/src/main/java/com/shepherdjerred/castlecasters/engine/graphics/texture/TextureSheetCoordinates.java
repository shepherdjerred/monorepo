package com.shepherdjerred.castlecasters.engine.graphics.texture;

import com.shepherdjerred.castlecasters.engine.graphics.RendererCoordinate;
import lombok.Getter;
import lombok.ToString;

@Getter
@ToString
public class TextureSheetCoordinates {

  private final double minX;
  private final double maxX;
  private final double minY;
  private final double maxY;
  private final RendererCoordinate topLeft;
  private final RendererCoordinate topRight;
  private final RendererCoordinate bottomLeft;
  private final RendererCoordinate bottomRight;

  public TextureSheetCoordinates(double minX, double maxX, double minY, double maxY) {
    this.minX = minX;
    this.maxX = maxX;
    this.minY = minY;
    this.maxY = maxY;
    this.topLeft = new RendererCoordinate((float) minX, (float) minY);
    this.topRight = new RendererCoordinate((float) maxX, (float) minY);
    this.bottomLeft = new RendererCoordinate((float) minX, (float) maxY);
    this.bottomRight = new RendererCoordinate((float) maxX, (float) maxY);
  }

  public TextureSheetCoordinates flipX() {
    return new TextureSheetCoordinates(maxX, minX, minY, maxY);
  }

  public TextureSheetCoordinates flipY() {
    return new TextureSheetCoordinates(minX, maxX, maxY, minY);
  }

  // TODO better name
  public float[] firstHalf() {
    return new float[]{
        topLeft.getX(), topLeft.getY(),
        bottomLeft.getX(), bottomLeft.getY(),
        topRight.getX(), topRight.getY()
    };
  }

  // TODO better name
  public float[] secondHalf() {
    return new float[]{
        bottomRight.getX(), bottomRight.getY(),
        bottomLeft.getX(), bottomLeft.getY(),
        topRight.getX(), topRight.getY()
    };
  }

  public float[] asFloatArray() {
    return new float[]{
        topLeft.getX(), topLeft.getY(),
        bottomLeft.getX(), bottomLeft.getY(),
        topRight.getX(), topRight.getY(),
        bottomRight.getX(), bottomRight.getY(),
        bottomLeft.getX(), bottomLeft.getY(),
        topRight.getX(), topRight.getY()
    };
  }

  public float[] asIndexedFloatArray() {
    return new float[]{
        topLeft.getX(), topLeft.getY(),
        bottomLeft.getX(), bottomLeft.getY(),
        topRight.getX(), topRight.getY(),
        bottomRight.getX(), bottomRight.getY()
    };
  }

  public float[] asHorizontallyFlippedArray() {
    return new float[]{
        topRight.getX(), topRight.getY(),
        bottomRight.getX(), bottomRight.getY(),
        topLeft.getX(), topLeft.getY(),
        bottomLeft.getX(), bottomLeft.getY()
    };
  }
}
