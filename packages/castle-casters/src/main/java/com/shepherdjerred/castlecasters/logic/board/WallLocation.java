package com.shepherdjerred.castlecasters.logic.board;

import com.google.common.base.Preconditions;

public record WallLocation(Coordinate firstCoordinate, Coordinate vertex, Coordinate secondCoordinate) {

  public WallLocation(Coordinate firstCoordinate,
                      Coordinate vertex,
                      Coordinate secondCoordinate) {
    Preconditions.checkNotNull(firstCoordinate);
    Preconditions.checkNotNull(vertex);
    Preconditions.checkNotNull(secondCoordinate);
    this.firstCoordinate = firstCoordinate;
    this.vertex = vertex;
    this.secondCoordinate = secondCoordinate;
    if (isInvalid()) {
      throw new IllegalArgumentException();
    }
  }

  private boolean isInvalid() {
    return !areCoordinatesAdjacentToVertex() || !areCoordinatesInStraightLine();
  }

  private boolean areCoordinatesAdjacentToVertex() {
    return firstCoordinate.isAdjacent(vertex) && secondCoordinate.isAdjacent(vertex);
  }

  private boolean areCoordinatesInStraightLine() {
    return (firstCoordinate.x() == vertex.x() && secondCoordinate.x() == vertex.x())
        || (firstCoordinate.y() == vertex.y() && secondCoordinate.y() == vertex.y());
  }
}
