package com.shepherdjerred.castlecasters.engine.map;

import com.google.common.base.Charsets;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.shepherdjerred.castlecasters.engine.map.tileset.TileIdTilesetMapper;
import com.shepherdjerred.castlecasters.engine.map.tileset.Tileset;
import com.shepherdjerred.castlecasters.engine.map.tileset.TilesetNameToTextureMapper;
import com.shepherdjerred.castlecasters.engine.resource.ByteBufferLoader;
import com.shepherdjerred.castlecasters.engine.resource.ResourceFileLocator;
import com.shepherdjerred.castlecasters.engine.resource.ResourceLoader;
import lombok.AllArgsConstructor;
import lombok.extern.log4j.Log4j2;

import java.nio.ByteBuffer;
import java.util.SortedSet;
import java.util.TreeSet;

@Log4j2
@AllArgsConstructor
public class GameMapLoader implements ResourceLoader<GameMapName, MapLayers> {

  private final ByteBufferLoader loader;
  private final ResourceFileLocator locator;

  @Override
  public MapLayers get(GameMapName identifier) throws Exception {
    var tilesetNameMapper = new TilesetNameToTextureMapper();
    var filePath = locator.getMapPath(identifier);
    var mapByteBuffer = loader.load(filePath);
    var json = byteBufferToJson(mapByteBuffer);

    SortedSet<Tileset> tilesets = new TreeSet<>();

    var tilesetsAsArray = json.getAsJsonArray("tilesets");

    tilesetsAsArray.forEach(tilesetEntry -> {
      var tilesetAsObject = tilesetEntry.getAsJsonObject();

      var name = tilesetAsObject.getAsJsonPrimitive("name").getAsString();
      var firstId = tilesetAsObject.getAsJsonPrimitive("firstgid").getAsInt();
      var columns = tilesetAsObject.getAsJsonPrimitive("columns").getAsInt();
      var tilecount = tilesetAsObject.getAsJsonPrimitive("tilecount").getAsInt();
      var tileHeight = tilesetAsObject.getAsJsonPrimitive("tileheight").getAsInt();
      var tileWidth = tilesetAsObject.getAsJsonPrimitive("tilewidth").getAsInt();

      if (tileHeight != tileWidth) {
        throw new IllegalStateException();
      }

      log.info(tilesetAsObject);

      var texture = tilesetNameMapper.getTextureNameForTilesheet(name);
      var tileset = new Tileset(name, firstId, columns, tilecount / columns, tileHeight, texture);
      tilesets.add(tileset);
    });

    var tilesetTileIdMapper = new TileIdTilesetMapper(tilesets);

    var layers = json.getAsJsonArray("layers");

    var mapWidth = json.getAsJsonPrimitive("width").getAsInt();
    var mapHeight = json.getAsJsonPrimitive("height").getAsInt();

    var mapDimensions = new MapDimensions(mapWidth, mapHeight);
    var gameMap = new MapLayers(mapDimensions);

    for (int layerId = 0; layerId < layers.size(); layerId++) {

      var layer = new Layer(mapDimensions, layers.size() - layerId);
      var layerTiles = layers.get(layerId)
          .getAsJsonObject()
          .getAsJsonArray("data");

      for (int tileNumber = 0; tileNumber < layerTiles.size(); tileNumber++) {
        var x = tileNumber % mapDimensions.width();
        var y = tileNumber / mapDimensions.width();
        var coord = new MapCoordinate(x, y);

        var tileTexture = layerTiles.get(tileNumber).getAsInt();

        if (tileTexture == 0) {
          continue;
        }

        var tileset = tilesetTileIdMapper.getTilesetForTileId(tileTexture);

        layer.setTile(new MapCoordinate(x, y),
            new MapTile(coord,
                tileset.textureName(),
                tileset.getTextureCoordinate(tileTexture)));
      }

      gameMap.setLayer(layerId, layer);
    }

    return gameMap;
  }

  private JsonObject byteBufferToJson(ByteBuffer byteBuffer) {
    var mapBytes = new byte[byteBuffer.remaining()];
    byteBuffer.get(mapBytes);
    var mapJsonString = new String(mapBytes, Charsets.UTF_8);
    return (JsonObject) JsonParser.parseString(mapJsonString);
  }
}
