package com.shepherdjerred.castlecasters.common.lobby;

import com.shepherdjerred.castlecasters.common.player.Player;
import com.shepherdjerred.castlecasters.logic.player.PlayerCount;
import com.shepherdjerred.castlecasters.logic.player.QuoridorPlayer;
import lombok.EqualsAndHashCode;
import lombok.ToString;

import java.util.HashMap;
import java.util.Map;

import static com.google.common.base.Preconditions.checkArgument;
import static com.google.common.base.Preconditions.checkNotNull;

/**
 * GameMap QuoridorPlayers to Players.
 */
@ToString
@EqualsAndHashCode
class PlayerSlots {

  private final Map<QuoridorPlayer, Player> playerIdMap;
  private final PlayerCount playerCount;

  private PlayerSlots(Map<QuoridorPlayer, Player> playerIdMap,
                      PlayerCount playerCount) {
    this.playerIdMap = playerIdMap;
    this.playerCount = playerCount;
  }

  // TODO this could be better
  static PlayerSlots forPlayerCount(PlayerCount playerCount) {
    Map<QuoridorPlayer, Player> playerIdMap = new HashMap<>();
    for (int i = 1; i < playerCount.toInt() + 1; i++) {
      var playerId = QuoridorPlayer.fromInt(i);
      playerIdMap.put(playerId, null);
    }
    return new PlayerSlots(playerIdMap, playerCount);
  }

  boolean areSlotsFull() {
    return getFreeSlots() <= 0;
  }

  boolean hasEmptySlot() {
    return getFreeSlots() > 0;
  }

  Player getPlayer(QuoridorPlayer playerId) {
    return playerIdMap.get(playerId);
  }

  PlayerSlots removePlayer(QuoridorPlayer playerId) {
    checkNotNull(playerId);

    var newQuoridorPlayerMap = new HashMap<>(playerIdMap);
    newQuoridorPlayerMap.remove(playerId);
    return new PlayerSlots(newQuoridorPlayerMap, playerCount);
  }

  QuoridorPlayer getPlayerIdByPlayer(Player player) {
    checkNotNull(player);

    QuoridorPlayer playerId = null;

    for (Map.Entry<QuoridorPlayer, Player> pair : playerIdMap.entrySet()) {
      if (pair.getValue().uuid() == player.uuid()) {
        playerId = pair.getKey();
        break;
      }
    }

    return playerId;
  }

  PlayerSlots setPlayer(QuoridorPlayer playerId, Player player) {
    checkNotNull(playerId);
    checkNotNull(player);
    checkArgument(playerId != QuoridorPlayer.NULL);

    if (playerId.toInt() > playerCount.toInt()) {
      throw new IllegalArgumentException("Player ID is invalid for this player count");
    }

    var newQuoridorPlayerMap = new HashMap<>(playerIdMap);
    newQuoridorPlayerMap.put(playerId, player);
    return new PlayerSlots(newQuoridorPlayerMap, playerCount);
  }

  PlayerSlots addPlayer(Player player) {
    checkNotNull(player);

    QuoridorPlayer playerId = null;

    for (Map.Entry<QuoridorPlayer, Player> pair : playerIdMap.entrySet()) {
      if (pair.getValue() == null) {
        playerId = pair.getKey();
        break;
      }
    }

    return setPlayer(playerId, player);
  }

  int getFreeSlots() {
    return playerIdMap.values().stream()
        .mapToInt(player -> {
          if (player == null) {
            return 1;
          } else {
            return 0;
          }
        }).sum();
  }

  int getTakenSlots() {
    return getMaxSlots() - getFreeSlots();
  }

  int getMaxSlots() {
    return playerCount.toInt();
  }
}
