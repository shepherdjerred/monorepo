package com.shepherdjerred.castlecasters.ai.evaluator.rules;

import com.shepherdjerred.castlecasters.logic.match.Match;
import com.shepherdjerred.castlecasters.logic.player.QuoridorPlayer;
import lombok.ToString;

@ToString
public class WallsNearbyEvaluationRule implements EvaluatorRule {

  @Override
  public double evaluate(Match match, QuoridorPlayer player) {
    var board = match.board();
    var pawnLocation = board.getPawnLocation(player);
    var adjacentWallLocations = board.getWallCellsAdjacentToPawnSpace(pawnLocation);
    return adjacentWallLocations.stream().filter(board::hasPiece).count();
  }
}
