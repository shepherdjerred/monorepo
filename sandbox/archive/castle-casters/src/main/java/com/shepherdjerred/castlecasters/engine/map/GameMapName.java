package com.shepherdjerred.castlecasters.engine.map;

import com.shepherdjerred.castlecasters.engine.resource.ResourceIdentifier;

import java.util.Random;

public enum GameMapName implements ResourceIdentifier {
  GRASS, WINTER, DESERT;

  public static GameMapName random() {
    var random = new Random();
    var values = GameMapName.values();
    return values[random.nextInt(values.length)];
  }
}
