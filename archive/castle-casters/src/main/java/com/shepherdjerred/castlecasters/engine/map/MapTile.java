package com.shepherdjerred.castlecasters.engine.map;

import com.shepherdjerred.castlecasters.engine.graphics.texture.TextureName;
import com.shepherdjerred.castlecasters.engine.graphics.texture.TextureSheetCoordinates;

/**
 * A single tile on a map.
 */
public record MapTile(MapCoordinate position, TextureName textureName,
                      TextureSheetCoordinates textureSheetCoordinates) {

}
