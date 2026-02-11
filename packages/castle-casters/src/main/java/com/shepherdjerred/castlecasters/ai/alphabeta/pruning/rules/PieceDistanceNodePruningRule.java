package com.shepherdjerred.castlecasters.ai.alphabeta.pruning.rules;

import com.shepherdjerred.castlecasters.ai.alphabeta.pruning.PruningQuoridorNode;
import com.shepherdjerred.castlecasters.logic.board.Coordinate;
import com.shepherdjerred.castlecasters.logic.turn.MovePawnTurn;
import com.shepherdjerred.castlecasters.logic.turn.PlaceWallTurn;
import lombok.AllArgsConstructor;
import lombok.ToString;
import lombok.extern.log4j.Log4j2;

import java.util.HashSet;
import java.util.Set;

@Log4j2
@ToString
@AllArgsConstructor
public class PieceDistanceNodePruningRule implements NodePruningRule {

  private final int distance;

  @Override
  public boolean shouldPrune(PruningQuoridorNode node) {
    var match = node.getMatch();
    var turn = node.getTurn();
    var pieceCoords = match.board().getPieceLocations();

    Set<Coordinate> turnCoords = new HashSet<>();
    if (turn instanceof MovePawnTurn) {
      return false;
    } else if (turn instanceof PlaceWallTurn) {
      var wallLocation = ((PlaceWallTurn) turn).location();
      turnCoords.add(wallLocation.firstCoordinate());
      turnCoords.add(wallLocation.vertex());
      turnCoords.add(wallLocation.secondCoordinate());
    } else {
      throw new UnsupportedOperationException();
    }


    var shouldBePruned = pieceCoords.stream()
        .filter(pieceCoord -> !turnCoords.contains(pieceCoord))
        .allMatch(pieceCoord -> turnCoords.stream()
            .allMatch(turnCoordinate -> Coordinate.calculateManhattanDistance(pieceCoord, turnCoordinate)
                > distance));

    return shouldBePruned;

  }
}
