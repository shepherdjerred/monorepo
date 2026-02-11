package com.shepherdjerred.castlecasters.common;

import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.ToString;

@Getter
@ToString
@AllArgsConstructor
public enum GameMap {
  GRASS(9),
  GRASS_BIG(11),
  GRASS_SMALL(7),
  WINTER(9),
  WINTER_BIG(7),
  WINTER_SMALL(11),
  DESERT(9),
  DESERT_BIG(7),
  DESERT_SMALL(11);

  private final int boardSize;

}
