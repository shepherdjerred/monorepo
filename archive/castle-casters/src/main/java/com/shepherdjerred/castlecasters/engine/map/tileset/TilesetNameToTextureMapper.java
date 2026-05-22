package com.shepherdjerred.castlecasters.engine.map.tileset;

import com.shepherdjerred.castlecasters.engine.graphics.texture.TextureName;

import java.util.HashMap;
import java.util.Map;

import static com.shepherdjerred.castlecasters.engine.graphics.texture.TextureName.*;

/**
 * Maps the names of tilesets to textures.
 */
public class TilesetNameToTextureMapper {

  private final Map<String, TextureName> textureMap;

  public TilesetNameToTextureMapper() {
    textureMap = new HashMap<>();
    initializeMap();
  }

  private void initializeMap() {
    textureMap.put("terrain", TERRAIN_TILESHEET);
    textureMap.put("desert", DESERT_TILESHEET);
    textureMap.put("castle", CASTLE_TILESHEET);
    textureMap.put("water", WATER_TILESHEET);
    textureMap.put("tf_darkdimension_sheet", DARK_DIMENSION_TILESHEET);
    textureMap.put("darkdimension", DARK_DIMENSION_TILESHEET);
    textureMap.put("tf_winter_tileB", WINTER_TILE_B_TILESHEET);
    textureMap.put("tf_winter_tileC", WINTER_TILE_C_TILESHEET);
    textureMap.put("chests", CHESTS_TILESHEET);
    textureMap.put("tf_winter_terrain", WINTER_TERRAIN_TILESHEET);
    textureMap.put("tf_B_ruins1", B_RUINS_1_TILESHEET);
    textureMap.put("torch", TORCH_TILESHEET);
    textureMap.put("ice", ICE_TILESHEET);
  }

  public TextureName getTextureNameForTilesheet(String tilesheet) {
    if (textureMap.containsKey(tilesheet)) {
      return textureMap.get(tilesheet);
    } else {
      throw new IllegalArgumentException("No such tilesheet mapped: " + tilesheet);
    }
  }
}
