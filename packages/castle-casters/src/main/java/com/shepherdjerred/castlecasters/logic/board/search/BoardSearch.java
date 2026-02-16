package com.shepherdjerred.castlecasters.logic.board.search;

import com.github.bentorfs.ai.search.asearch.AStarSearchNode;
import com.shepherdjerred.castlecasters.logic.board.Coordinate;
import com.shepherdjerred.castlecasters.logic.board.QuoridorBoard;

import java.util.Set;

public interface BoardSearch {

  boolean hasPathToDestination(QuoridorBoard board, Coordinate source, Coordinate destination);

  boolean hasPathToAnyDestination(QuoridorBoard board, Coordinate source, Set<Coordinate> destinations);

  int getShortestPathToDestination(QuoridorBoard board, Coordinate source, Coordinate destination);

  int getShortestPathToAnyDestination(QuoridorBoard board, Coordinate source, Set<Coordinate> destinations);

  AStarSearchNode getPathToDestination(QuoridorBoard board, Coordinate source, Coordinate destination);

  AStarSearchNode getPathToAnyDestination(QuoridorBoard board, Coordinate source, Set<Coordinate> destination);
}
