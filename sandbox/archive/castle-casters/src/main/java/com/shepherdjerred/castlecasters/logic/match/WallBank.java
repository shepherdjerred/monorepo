package com.shepherdjerred.castlecasters.logic.match;

import com.shepherdjerred.castlecasters.logic.player.PlayerCount;
import com.shepherdjerred.castlecasters.logic.player.QuoridorPlayer;
import lombok.EqualsAndHashCode;
import lombok.ToString;

import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;

@ToString
@EqualsAndHashCode
public class WallBank {

  public final Map<QuoridorPlayer, Integer> playerWalls;

  private WallBank(Map<QuoridorPlayer, Integer> playerWalls) {
    this.playerWalls = playerWalls;
  }

  public static WallBank from(PlayerCount playerCount, int numberOfWalls) {
    Map<QuoridorPlayer, Integer> walls = new HashMap<>();
    Set<QuoridorPlayer> quoridorPlayers = new HashSet<>();
    quoridorPlayers.add(QuoridorPlayer.ONE);
    quoridorPlayers.add(QuoridorPlayer.TWO);
    if (playerCount == PlayerCount.FOUR) {
      quoridorPlayers.add(QuoridorPlayer.THREE);
      quoridorPlayers.add(QuoridorPlayer.FOUR);
    }
    quoridorPlayers.forEach(player -> walls.put(player, numberOfWalls));
    return new WallBank(walls);
  }

  public static WallBank fromCounts(java.util.List<Integer> counts, int maximum) {
    if (counts.size() != 2 && counts.size() != 4) throw new IllegalArgumentException("Invalid wall counts");
    var result = new HashMap<QuoridorPlayer, Integer>();
    for (int i = 0; i < counts.size(); i++) {
      int count = counts.get(i);
      if (count < 0 || count > maximum) throw new IllegalArgumentException("Invalid wall count");
      result.put(QuoridorPlayer.fromInt(i + 1), count);
    }
    return new WallBank(result);
  }

  public int getWallsLeft(QuoridorPlayer quoridorPlayer) {
    if (playerWalls.containsKey(quoridorPlayer)) {
      return playerWalls.get(quoridorPlayer);
    } else {
      throw new IllegalArgumentException(quoridorPlayer.toString());
    }
  }

  public WallBank takeWall(QuoridorPlayer quoridorPlayer) {
    if (playerWalls.containsKey(quoridorPlayer)) {
      Map<QuoridorPlayer, Integer> newWallCounts = new HashMap<>(playerWalls);
      var currentWallsLeft = getWallsLeft(quoridorPlayer) - 1;
      newWallCounts.put(quoridorPlayer, currentWallsLeft);
      return new WallBank(newWallCounts);
    } else {
      throw new IllegalArgumentException(quoridorPlayer.toString());
    }
  }
}
