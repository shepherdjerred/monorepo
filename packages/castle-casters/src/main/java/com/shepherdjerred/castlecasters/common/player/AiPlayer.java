package com.shepherdjerred.castlecasters.common.player;

import java.util.UUID;

public record AiPlayer(UUID uuid, String name, Element element,
                       com.shepherdjerred.castlecasters.common.player.AiPlayer.Difficulty difficulty) implements Player {

  public enum Difficulty {
    HARD
  }
}
