package com.shepherdjerred.castlecasters.engine.map.tileset;

import com.shepherdjerred.castlecasters.engine.graphics.texture.TextureName;
import com.shepherdjerred.castlecasters.engine.graphics.texture.TextureSheetCoordinates;
import lombok.extern.log4j.Log4j2;

import java.math.BigDecimal;
import java.math.MathContext;

@Log4j2
public record Tileset(String name, int firstTile, int columns, int rows, int tileSize,
                      TextureName textureName) implements Comparable<Tileset> {

  /**
   * This is brittle, but it'll work.
   */
  public TextureSheetCoordinates getTextureCoordinate(int tile) {
    var value = tile - firstTile;
    var column = value % columns;
    var row = value / columns;
    var width = columns * tileSize;
    var height = rows * tileSize;

    double minX = column * tileSize;
    double maxX = column * tileSize + tileSize;
    double minY = row * tileSize;
    double maxY = row * tileSize + tileSize;

    double scaledMinX = new BigDecimal(minX)
        .divide(BigDecimal.valueOf(width), MathContext.DECIMAL128)
        .floatValue();
    double scaledMaxX = new BigDecimal(maxX)
        .divide(BigDecimal.valueOf(width), MathContext.DECIMAL128)
        .floatValue();
    double scaledMinY = new BigDecimal(minY)
        .divide(BigDecimal.valueOf(height), MathContext.DECIMAL128)
        .floatValue();
    double scaledMaxY = new BigDecimal(maxY)
        .divide(BigDecimal.valueOf(height), MathContext.DECIMAL128)
        .floatValue();

    return new TextureSheetCoordinates(scaledMinX, scaledMaxX, scaledMinY, scaledMaxY);
  }

  @Override
  public int compareTo(Tileset tileset) {
    return this.firstTile - tileset.firstTile();
  }
}
