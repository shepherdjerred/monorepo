package com.shepherdjerred.thestorm.economy.app;

import java.util.UUID;

/**
 * A player who has joined The Storm, with the name they last joined under.
 *
 * @param uuid their id
 * @param name their name at their latest join
 */
public record SeenPlayer(UUID uuid, String name) {

  public SeenPlayer {
    if (name.isBlank()) {
      throw new IllegalArgumentException("a player name must not be blank");
    }
  }

  public AccountId.Player account() {
    return new AccountId.Player(uuid);
  }
}
