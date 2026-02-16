package com.shepherdjerred.castlecasters.common.lobby;

import com.shepherdjerred.castlecasters.common.GameMap;
import com.shepherdjerred.castlecasters.logic.match.MatchSettings;

public record LobbySettings(String name, MatchSettings matchSettings,
                            com.shepherdjerred.castlecasters.common.lobby.LobbySettings.LobbyType lobbyType,
                            boolean isDuplicateElementsEnabled, GameMap gameMap) {

  public enum LobbyType {
    LOCAL, NETWORK
  }
}
