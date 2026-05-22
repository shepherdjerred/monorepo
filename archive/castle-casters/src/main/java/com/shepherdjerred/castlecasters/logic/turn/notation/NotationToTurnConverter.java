package com.shepherdjerred.castlecasters.logic.turn.notation;

import com.google.common.base.Preconditions;
import com.shepherdjerred.castlecasters.logic.board.Coordinate;
import com.shepherdjerred.castlecasters.logic.board.WallLocation;
import com.shepherdjerred.castlecasters.logic.player.QuoridorPlayer;
import com.shepherdjerred.castlecasters.logic.turn.NormalMovePawnTurn;
import com.shepherdjerred.castlecasters.logic.turn.PlaceWallTurn;
import com.shepherdjerred.castlecasters.logic.turn.Turn;

public class NotationToTurnConverter {

  public Turn convert(String string) {
    var length = string.length();
    Preconditions.checkArgument(length == 2 || length == 3);
    string = string.toLowerCase();
    if (length == 2) {
      return stringToMovePawnTurn(string);
    } else {
      return stringToPlaceWallTurn(string);
    }
  }

  private int notationCharToXCoord(char notationChar) {
    var intValue = (int) notationChar - 97;
    Preconditions.checkArgument(intValue >= 0);
    Preconditions.checkArgument(intValue - 97 <= 9);
    return intValue * 2;
  }

  private int notationIntToYCoord(int notationInt) {
    Preconditions.checkArgument(notationInt >= 0);
    Preconditions.checkArgument(notationInt <= 9);
    return (notationInt - 1) * 2;
  }

  private NormalMovePawnTurn stringToMovePawnTurn(String string) {
    var y = notationIntToYCoord(Character.getNumericValue(string.charAt(1)));
    var x = notationCharToXCoord(string.charAt(0));
    return new NormalMovePawnTurn(QuoridorPlayer.NULL, null, new Coordinate(x, y));
  }

  private PlaceWallTurn stringToPlaceWallTurn(String string) {
    var y = notationIntToYCoord(Character.getNumericValue(string.charAt(1)));
    var x = notationCharToXCoord(string.charAt(0));

    var orientation = WallOrientation.fromNotationChar(string.charAt(2));
    var wallLocation = getWallLocation(new Coordinate(x, y), orientation);
    return new PlaceWallTurn(QuoridorPlayer.NULL, wallLocation);
  }

  private WallLocation getWallLocation(Coordinate coordinate,
                                       WallOrientation orientation) {
    if (orientation == WallOrientation.HORIZONTAL) {
      var c1 = coordinate.above();
      var vertex = c1.toRight();
      var c2 = vertex.toRight();

      return new WallLocation(c1, vertex, c2);
    } else if (orientation == WallOrientation.VERTICAL) {
      var c1 = coordinate.toRight();
      var vertex = c1.above();
      var c2 = vertex.above();

      return new WallLocation(c1, vertex, c2);
    } else {
      throw new UnsupportedOperationException();
    }
  }


}
