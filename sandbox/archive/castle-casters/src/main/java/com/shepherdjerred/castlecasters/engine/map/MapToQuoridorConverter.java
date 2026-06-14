package com.shepherdjerred.castlecasters.engine.map;

import com.google.common.collect.BiMap;
import com.google.common.collect.HashBiMap;
import com.shepherdjerred.castlecasters.logic.board.Coordinate;

public class MapToQuoridorConverter {

  private final BiMap<Coordinate, MapCoordinate> coordinates = HashBiMap.create();

  public MapToQuoridorConverter() {
    createMap();
  }

  private void createMap() {
    var mapStartX = 21;
    var mapStartY = 14;
    for (int x = 0; x <= 17; x++) {
      for (int y = 0; y <= 17; y++) {
        var quoridorCoordinate = new Coordinate(x, y);
        var mapCoordinate = new MapCoordinate(mapStartX + x, mapStartY + 16 - y);
        coordinates.put(quoridorCoordinate, mapCoordinate);
      }
    }
  }

  public MapCoordinate convert(Coordinate boardCoordinate) {
    return coordinates.get(boardCoordinate);
  }

  public Coordinate convert(MapCoordinate coordinate) {
    return coordinates.inverse().get(coordinate);
  }
}
