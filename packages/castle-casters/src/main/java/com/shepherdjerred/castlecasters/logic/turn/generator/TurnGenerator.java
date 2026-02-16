package com.shepherdjerred.castlecasters.logic.turn.generator;

import com.shepherdjerred.castlecasters.logic.board.Coordinate;
import com.shepherdjerred.castlecasters.logic.board.WallLocation;
import com.shepherdjerred.castlecasters.logic.match.Match;
import com.shepherdjerred.castlecasters.logic.turn.*;
import com.shepherdjerred.castlecasters.logic.turn.validator.TurnValidatorFactory;
import lombok.AllArgsConstructor;

import java.util.HashSet;
import java.util.Set;
import java.util.stream.Collectors;

@AllArgsConstructor
public class TurnGenerator {

  private final TurnValidatorFactory turnValidatorFactory;

  public Set<Turn> generateValidTurns(Match match) {
    var allTurns = generateTurns(match);
    return filterInvalidTurns(match, allTurns);
  }

  public Set<Turn> generateInvalidTurns(Match match) {
    var allTurns = generateTurns(match);
    return filterValidTurns(match, allTurns);
  }

  private Set<Turn> generateTurns(Match match) {
    Set<Turn> turns = new HashSet<>();
    var movePawnTurns = generateMovePawnTurns(match);
    var placeWallTurns = generatePlaceWallTurns(match);
    turns.addAll(movePawnTurns);
    turns.addAll(placeWallTurns);
    return turns;
  }

  private Set<Turn> filterInvalidTurns(Match match, Set<Turn> turns) {
    return turns.stream()
        .filter(turn -> {
          var validator = turnValidatorFactory.getValidator(turn);
          return !validator.validate(match, turn).isError();
        })
        .collect(Collectors.toSet());
  }

  private Set<Turn> filterValidTurns(Match match, Set<Turn> turns) {
    return turns.stream()
        .filter(turn -> {
          var validator = turnValidatorFactory.getValidator(turn);
          return validator.validate(match, turn).isError();
        })
        .collect(Collectors.toSet());
  }

  private Set<MovePawnTurn> generateMovePawnTurns(Match match) {
    Set<MovePawnTurn> turns = new HashSet<>();

    turns.addAll(generateNormalMovePawnTurns(match));
    turns.addAll(generateJumpMovePawnTurns(match));

    return turns;
  }

  private Set<NormalMovePawnTurn> generateNormalMovePawnTurns(Match match) {
    Set<NormalMovePawnTurn> turns = new HashSet<>();

    var player = match.getActivePlayerId();
    var pawnLocation = match.board().getPawnLocation(player);

    var coordLeft = pawnLocation.toLeft(2);
    var coordRight = pawnLocation.toRight(2);
    var coordAbove = pawnLocation.above(2);
    var coordBelow = pawnLocation.below(2);

    var leftMove = new NormalMovePawnTurn(player, pawnLocation, coordLeft);
    var rightMove = new NormalMovePawnTurn(player, pawnLocation, coordRight);
    var aboveMove = new NormalMovePawnTurn(player, pawnLocation, coordAbove);
    var belowMove = new NormalMovePawnTurn(player, pawnLocation, coordBelow);

    turns.add(leftMove);
    turns.add(rightMove);
    turns.add(aboveMove);
    turns.add(belowMove);

    return turns;
  }

  // Lots of repeated code :(
  private Set<JumpPawnTurn> generateJumpMovePawnTurns(Match match) {
    Set<JumpPawnTurn> turns = new HashSet<>();

    var player = match.getActivePlayerId();
    var pawnLocation = match.board().getPawnLocation(player);

    var coordLeft = pawnLocation.toLeft(2);
    var coordRight = pawnLocation.toRight(2);
    var coordAbove = pawnLocation.above(2);
    var coordBelow = pawnLocation.below(2);

    if (match.board().hasPiece(coordLeft)) {
      var diagAbove = coordLeft.above(2);
      var diagBelow = coordLeft.below(2);
      var straight = coordLeft.toLeft(2);

      var diagAboveMove = new JumpPawnDiagonalTurn(player, pawnLocation, diagAbove, coordLeft);
      var diagBelowMove = new JumpPawnDiagonalTurn(player, pawnLocation, diagBelow, coordLeft);
      var straightMove = new JumpPawnStraightTurn(player, pawnLocation, straight, coordLeft);

      turns.add(diagAboveMove);
      turns.add(diagBelowMove);
      turns.add(straightMove);
    }

    if (match.board().hasPiece(coordRight)) {
      var diagAbove = coordRight.above(2);
      var diagBelow = coordRight.below(2);
      var straight = coordRight.toRight(2);

      var diagAboveMove = new JumpPawnDiagonalTurn(player, pawnLocation, diagAbove, coordRight);
      var diagBelowMove = new JumpPawnDiagonalTurn(player, pawnLocation, diagBelow, coordRight);
      var straightMove = new JumpPawnStraightTurn(player, pawnLocation, straight, coordRight);

      turns.add(diagAboveMove);
      turns.add(diagBelowMove);
      turns.add(straightMove);
    }

    if (match.board().hasPiece(coordAbove)) {
      var diagLeft = coordAbove.toLeft(2);
      var diagRight = coordAbove.toRight(2);
      var straight = coordAbove.above(2);

      var diagLeftMove = new JumpPawnDiagonalTurn(player, pawnLocation, diagLeft, coordAbove);
      var diagRightMove = new JumpPawnDiagonalTurn(player, pawnLocation, diagRight, coordAbove);
      var straightMove = new JumpPawnStraightTurn(player, pawnLocation, straight, coordAbove);

      turns.add(diagLeftMove);
      turns.add(diagRightMove);
      turns.add(straightMove);
    }

    if (match.board().hasPiece(coordBelow)) {
      var diagLeft = coordBelow.toLeft(2);
      var diagRight = coordBelow.toRight(2);
      var straight = coordBelow.below(2);

      var diagLeftMove = new JumpPawnDiagonalTurn(player, pawnLocation, diagLeft, coordBelow);
      var diagRightMove = new JumpPawnDiagonalTurn(player, pawnLocation, diagRight, coordBelow);
      var straightMove = new JumpPawnStraightTurn(player, pawnLocation, straight, coordBelow);

      turns.add(diagLeftMove);
      turns.add(diagRightMove);
      turns.add(straightMove);
    }

    return turns;
  }

  private Set<PlaceWallTurn> generatePlaceWallTurns(Match match) {
    Set<PlaceWallTurn> turns = new HashSet<>();
    var player = match.getActivePlayerId();

    var gridSize = match.board().getGridSize();
    for (int x = 0; x < gridSize - 1; x++) {
      for (int y = 0; y < gridSize - 1; y++) {
        // Vertical walls
        if (x % 2 != 0 && y % 2 == 0) {
          var c1 = new Coordinate(x, y);
          var v = new Coordinate(x, y + 1);
          var c2 = new Coordinate(x, y + 2);

          var wallLocation = new WallLocation(c1, v, c2);
          var turn = new PlaceWallTurn(player, wallLocation);
          turns.add(turn);
        }
        // Horizontal walls
        if (x % 2 == 0 && y % 2 != 0) {
          var c1 = new Coordinate(x, y);
          var v = new Coordinate(x + 1, y);
          var c2 = new Coordinate(x + 2, y);

          var wallLocation = new WallLocation(c1, v, c2);
          var turn = new PlaceWallTurn(player, wallLocation);
          turns.add(turn);
        }
      }
    }

    return turns;
  }
}
