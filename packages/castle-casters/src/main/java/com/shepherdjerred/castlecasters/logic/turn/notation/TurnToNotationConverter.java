package com.shepherdjerred.castlecasters.logic.turn.notation;

import com.google.common.base.Preconditions;
import com.shepherdjerred.castlecasters.logic.board.Coordinate;
import com.shepherdjerred.castlecasters.logic.board.WallLocation;
import com.shepherdjerred.castlecasters.logic.turn.MovePawnTurn;
import com.shepherdjerred.castlecasters.logic.turn.PlaceWallTurn;
import com.shepherdjerred.castlecasters.logic.turn.Turn;

public class TurnToNotationConverter {

  public String convert(Turn turn) {
    if (turn instanceof MovePawnTurn) {
      return movePawnTurnToString((MovePawnTurn) turn);
    } else if (turn instanceof PlaceWallTurn) {
      return placeWallTurnToString((PlaceWallTurn) turn);
    } else {
      throw new UnsupportedOperationException();
    }
  }

  private String movePawnTurnToString(MovePawnTurn turn) {
    var dest = turn.destination();
    int y = yCoordToNotationInt(dest.y());
    char x = xCoordToNotationChar(dest.x());
    return String.format("%s%s", x, y);
  }

  private String placeWallTurnToString(PlaceWallTurn turn) {
    var location = turn.location();
    var space = getLowerLeftPawnSpace(location);
    var direction = getWallOrientation(location);
    int y = yCoordToNotationInt(space.y());
    char x = xCoordToNotationChar(space.x());
    var directionChar = direction.toNotationChar();
    return String.format("%s%s%s", x, y, directionChar);
  }

  private Coordinate getLowerLeftPawnSpace(WallLocation location) {
    return location.vertex().toLeft().below();
  }

  private WallOrientation getWallOrientation(WallLocation location) {
    var c1 = location.firstCoordinate();
    var c2 = location.secondCoordinate();

    if (c1.x() == c2.x()) {
      return WallOrientation.VERTICAL;
    }

    if (c1.y() == c2.y()) {
      return WallOrientation.HORIZONTAL;
    }

    throw new UnsupportedOperationException();
  }

  private char xCoordToNotationChar(int xCoord) {
    Preconditions.checkArgument(xCoord % 2 == 0);
    Preconditions.checkArgument(xCoord <= 16);
    return (char) ((xCoord / 2) + 97);
  }

  private int yCoordToNotationInt(int yCoord) {
    Preconditions.checkArgument(yCoord % 2 == 0);
    Preconditions.checkArgument(yCoord <= 16);
    return (yCoord / 2) + 1;
  }
}
