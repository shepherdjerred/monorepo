package com.shepherdjerred.castlecasters.engine.graphics.texture.spritesheet;

import com.shepherdjerred.castlecasters.engine.graphics.texture.TextureSheetCoordinates;
import lombok.Getter;
import lombok.extern.log4j.Log4j2;

/**
 * Calculates the position of sprites on a spritesheet.
 */
@Log4j2
public class Spritesheet {

  private final int width;
  private final int height;
  private final int spriteSize;
  @Getter
  private final int numberOfHorizonalTextures;
  @Getter
  private final int numberOfVerticalTextures;

  public Spritesheet(int width, int height, int spriteSize) {
    this.width = width;
    this.height = height;
    this.spriteSize = spriteSize;
    numberOfHorizonalTextures = width / spriteSize;
    numberOfVerticalTextures = height / spriteSize;
  }

  public TextureSheetCoordinates getCoordinatesForSprite(SpritesheetCoordinate coordinate) {
    var x = coordinate.x();
    var y = coordinate.y();

    float rawMinX = x * spriteSize;
    float rawMaxX = rawMinX + spriteSize;
    float rawMinY = y * spriteSize;
    float rawMaxY = rawMinY + spriteSize;

    float minX = rawMinX / width;
    float maxX = rawMaxX / width;
    float minY = rawMinY / height;
    float maxY = rawMaxY / height;

    return new TextureSheetCoordinates(minX, maxX, minY, maxY);
  }
}
