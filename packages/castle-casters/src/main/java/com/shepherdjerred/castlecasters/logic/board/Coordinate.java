package com.shepherdjerred.castlecasters.logic.board;

public record Coordinate(int x, int y) {

  public static boolean areCoordinatesCardinal(Coordinate left, Coordinate right) {
    return (left.x != right.x && left.y == right.y)
        || (left.x == right.x && left.y != right.y);
  }

  public static boolean areCoordinatesDiagonal(Coordinate left, Coordinate right) {
    return left.x != right.x
        && left.y != right.y;
  }

  /**
   * Gets the midpoint between two Coordinates. <a href="https://www.purplemath.com/modules/midpoint.htm">...</a>
   */
  public static Coordinate calculateMidpoint(Coordinate left, Coordinate right) {
    if (areCoordinatesDiagonal(left, right)) {
      throw new IllegalArgumentException("Cannot return a midpoint between diagonal coordinates");
    }
    if (calculateManhattanDistance(left, right) / 2 != 1) {
      throw new IllegalArgumentException("Distance between points must be odd");
    }
    int x = (left.x + right.x) / 2;
    int y = (left.y + right.y) / 2;
    return new Coordinate(x, y);
  }

  /**
   * Calculates the manhattan distance between two Coordinates. <a href="https://math.stackexchange.com/questions/139600/how-do-i-calculate-euclidean-and-manhattan-distance-by-hand">...</a>
   */
  public static int calculateManhattanDistance(Coordinate left, Coordinate right) {
    return Math.abs(left.x - right.x) + Math.abs(left.y - right.y);
  }

  public Coordinate fromOffset(int xOffset, int yOffset) {
    return new Coordinate(x + xOffset, y + yOffset);
  }

  public Coordinate toLeft() {
    return toLeft(1);
  }

  public Coordinate toRight() {
    return toRight(1);
  }

  public Coordinate above() {
    return above(1);
  }

  public Coordinate below() {
    return below(1);
  }

  public Coordinate toLeft(int i) {
    return new Coordinate(x - i, y);
  }

  public Coordinate toRight(int i) {
    return new Coordinate(x + i, y);
  }

  public Coordinate above(int i) {
    return new Coordinate(x, y + i);
  }

  public Coordinate below(int i) {
    return new Coordinate(x, y - i);
  }

  public boolean isAdjacent(Coordinate c) {
    var diff = Math.abs(x - c.x) + Math.abs(y - c.y);
    return diff == 1;
  }

  public boolean isCardinalTo(Coordinate coordinate) {
    return areCoordinatesCardinal(this, coordinate);
  }

  public boolean isDiagonalTo(Coordinate coordinate) {
    return areCoordinatesDiagonal(this, coordinate);
  }

  public Coordinate getCoordinateBetween(Coordinate coordinate) {
    return calculateMidpoint(this, coordinate);
  }

  public int getManhattanDistanceTo(Coordinate coordinate) {
    return calculateManhattanDistance(this, coordinate);
  }
}
