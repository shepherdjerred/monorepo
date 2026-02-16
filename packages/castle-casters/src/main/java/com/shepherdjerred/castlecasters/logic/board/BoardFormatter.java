package com.shepherdjerred.castlecasters.logic.board;

import com.shepherdjerred.castlecasters.logic.piece.NullPiece;

public class BoardFormatter {

  public String boardToString(QuoridorBoard board) {
    var gridSize = board.getGridSize();

    var sb = new StringBuilder();
    for (int y = gridSize - 1; y >= -4; y--) {
      if (y >= 0) {
        for (int x = 0; x < gridSize; x++) {
          var coordinate = new Coordinate(x, y);
          var displayChar = coordinateToChar(board, coordinate);
          if (x == 0) {
            if (y % 2 == 0) {
              sb.append(String.format("\n%d %02d ▍ ", (y / 2) + 1, y));
            } else {
              sb.append(String.format("\n  %02d ▍ ", y));
            }
          }
          sb.append(displayChar);
        }
      } else {
        for (int x = 0; x < gridSize; x++) {
          if (x == 0) {
            sb.append("\n       ");
          }
          if (y == -1) {
            sb.append("▂");
          } else if (y == -2) {
            if (x / 10 < 1) {
              sb.append(x);
            } else {
              sb.append(x / 10);
            }
          } else if (y == -3) {
            if (x / 10 >= 1) {
              sb.append(x % 10);
            } else {
              sb.append(' ');
            }
          } else {
            if (x % 2 == 0) {
              char c = (char) ((x / 2) + 97);
              sb.append(c);
            } else {
              sb.append(' ');
            }
          }
        }

      }
    }
    sb.append("\n");
    return sb.toString();
  }

  private char coordinateToChar(QuoridorBoard board, Coordinate coordinate) {
    var cell = board.getBoardCell(coordinate).toChar();
    var piece = board.getPiece(coordinate);
    return piece == NullPiece.INSTANCE ? cell : piece.toChar();
  }
}
