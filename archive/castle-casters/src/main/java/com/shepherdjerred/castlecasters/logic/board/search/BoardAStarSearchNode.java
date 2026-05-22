package com.shepherdjerred.castlecasters.logic.board.search;

import com.github.bentorfs.ai.common.TreeNode;
import com.github.bentorfs.ai.search.asearch.AStarSearchNode;
import com.shepherdjerred.castlecasters.logic.board.Coordinate;
import com.shepherdjerred.castlecasters.logic.board.QuoridorBoard;
import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.ToString;
import lombok.extern.log4j.Log4j2;

import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;

@Log4j2
@ToString(exclude = {"board", "goals"})
@AllArgsConstructor
public class BoardAStarSearchNode extends AStarSearchNode {

  private final int cost;
  private final QuoridorBoard board;
  @Getter
  private final Coordinate location;
  private final Set<Coordinate> goals;
  @Getter
  private final BoardAStarSearchNode parent;
  private final int depth;
  private int numberOfChildren;

  @Override
  public List<TreeNode> getChildNodes() {
    List<TreeNode> children = board.getPawnSpacesAdjacentToPawnSpace(location)
        .stream()
//        .peek(log::info)
        .filter(coordinate -> {
          var midpoint = Coordinate.calculateMidpoint(location, coordinate);
          return !board.hasWall(midpoint);
        })
        .map(space -> new BoardAStarSearchNode(cost + 1, board, space, goals, this, depth, 0))
//        .peek(log::info)
        .collect(Collectors.toList());
    this.numberOfChildren = children.size();
    return children;
  }

  @Override
  public boolean isSolutionNode() {
    return goals.contains(location);
  }

  @Override
  public int getCostSoFar() {
    return cost;
  }

  @Override
  public int getEstimatedCostToSolution() {
    return getDistanceToNearestGoal(location, goals);
  }

  @Override
  public boolean isSamePosition(AStarSearchNode node) {
    if (node instanceof BoardAStarSearchNode) {
      return location.equals(((BoardAStarSearchNode) node).location);
    } else {
      throw new UnsupportedOperationException();
    }
  }

  private int getDistanceToNearestGoal(Coordinate coordinate, Set<Coordinate> goals) {
    return goals.stream()
        .map(goal -> Coordinate.calculateManhattanDistance(coordinate, goal))
        .min(Integer::compareTo)
        .orElseThrow(IllegalStateException::new);
  }
}
