package com.shepherdjerred.castlecasters.logic.board.search;

import com.github.bentorfs.ai.search.asearch.ASearchAlgorithm;
import com.github.bentorfs.ai.search.asearch.AStarSearchNode;
import com.google.common.collect.ImmutableSet;
import com.shepherdjerred.castlecasters.logic.board.Coordinate;
import com.shepherdjerred.castlecasters.logic.board.QuoridorBoard;
import lombok.extern.log4j.Log4j2;

import java.util.Set;

@Log4j2
public class AStarBoardSearch implements BoardSearch {

  private final ASearchAlgorithm algorithm = new ASearchAlgorithm();

  @Override
  public boolean hasPathToDestination(QuoridorBoard board,
                                      Coordinate source,
                                      Coordinate destination) {
    return getPathToAnyDestination(board, source, ImmutableSet.of(destination)) != null;
  }

  @Override
  public boolean hasPathToAnyDestination(QuoridorBoard board,
                                         Coordinate source,
                                         Set<Coordinate> destinations) {
    return getPathToAnyDestination(board, source, destinations) != null;
  }

  @Override
  public int getShortestPathToDestination(QuoridorBoard board,
                                          Coordinate source,
                                          Coordinate destination) {
    return (int) getPathToAnyDestination(board, source, ImmutableSet.of(destination)).getValue();
  }

  @Override
  public int getShortestPathToAnyDestination(QuoridorBoard board,
                                             Coordinate source,
                                             Set<Coordinate> destinations) {
    return (int) getPathToAnyDestination(board, source, destinations).getValue();
  }

  @Override
  public AStarSearchNode getPathToDestination(QuoridorBoard board,
                                              Coordinate source,
                                              Coordinate destination) {
    var root = new BoardAStarSearchNode(0,
        board,
        source,
        ImmutableSet.of(destination),
        null,
        0,
        0);
    return algorithm.searchSolution(root);
  }

  @Override
  public AStarSearchNode getPathToAnyDestination(QuoridorBoard board,
                                                 Coordinate source,
                                                 Set<Coordinate> destinations) {
    var root = new BoardAStarSearchNode(0,
        board,
        source,
        destinations,
        null,
        0,
        0);
    return algorithm.searchSolution(root);
  }

}
