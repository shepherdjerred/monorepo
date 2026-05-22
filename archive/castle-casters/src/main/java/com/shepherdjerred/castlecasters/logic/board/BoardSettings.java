package com.shepherdjerred.castlecasters.logic.board;

import com.google.common.base.Preconditions;
import com.shepherdjerred.castlecasters.logic.player.PlayerCount;
import lombok.EqualsAndHashCode;
import lombok.Getter;
import lombok.ToString;

@Getter
@ToString
@EqualsAndHashCode
public class BoardSettings {

  private final int boardSize;
  private final int gridSize;
  private final PlayerCount playerCount;

  public BoardSettings(int boardSize, PlayerCount playerCount) {
    Preconditions.checkArgument(boardSize % 2 == 1);
    this.boardSize = boardSize;
    this.gridSize = boardSize * 2 - 1;
    this.playerCount = playerCount;
  }
}
