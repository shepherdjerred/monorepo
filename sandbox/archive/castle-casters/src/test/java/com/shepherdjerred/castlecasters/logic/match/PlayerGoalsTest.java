package com.shepherdjerred.castlecasters.logic.match;


import com.shepherdjerred.castlecasters.logic.board.Coordinate;
import com.shepherdjerred.castlecasters.logic.player.QuoridorPlayer;
import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;

import java.util.HashSet;
import java.util.Set;

public class PlayerGoalsTest {

  @Test
  public void getGoalsCoordinatesForPlayer_returnsGoalCoordinatesForPlayerOne_whenCalledWithPlayerOneAndGridSizeOf17() {
    var playerGoals = new PlayerGoals();
    var actual = playerGoals.getGoalCoordinatesForPlayer(QuoridorPlayer.ONE, 17);
    Set<Coordinate> expected = new HashSet<>();
    expected.add(new Coordinate(0, 16));
    expected.add(new Coordinate(2, 16));
    expected.add(new Coordinate(4, 16));
    expected.add(new Coordinate(6, 16));
    expected.add(new Coordinate(8, 16));
    expected.add(new Coordinate(10, 16));
    expected.add(new Coordinate(12, 16));
    expected.add(new Coordinate(14, 16));
    expected.add(new Coordinate(16, 16));

    Assertions.assertEquals(expected, actual);
  }

  @Test
  public void getGoalsCoordinatesForPlayer_returnsGoalCoordinatesForPlayerTwo_whenCalledWithPlayerTwoAndGridSizeOf17() {
    var playerGoals = new PlayerGoals();
    var actual = playerGoals.getGoalCoordinatesForPlayer(QuoridorPlayer.TWO, 17);
    Set<Coordinate> expected = new HashSet<>();
    expected.add(new Coordinate(0, 0));
    expected.add(new Coordinate(2, 0));
    expected.add(new Coordinate(4, 0));
    expected.add(new Coordinate(6, 0));
    expected.add(new Coordinate(8, 0));
    expected.add(new Coordinate(10, 0));
    expected.add(new Coordinate(12, 0));
    expected.add(new Coordinate(14, 0));
    expected.add(new Coordinate(16, 0));

    Assertions.assertEquals(expected, actual);
  }

  @Test
  public void getGoalsCoordinatesForPlayer_returnsGoalCoordinatesForPlayerThree_whenCalledWithPlayerThreeAndGridSizeOf17() {
    var playerGoals = new PlayerGoals();
    var actual = playerGoals.getGoalCoordinatesForPlayer(QuoridorPlayer.THREE, 17);
    Set<Coordinate> expected = new HashSet<>();
    expected.add(new Coordinate(16, 0));
    expected.add(new Coordinate(16, 2));
    expected.add(new Coordinate(16, 4));
    expected.add(new Coordinate(16, 6));
    expected.add(new Coordinate(16, 8));
    expected.add(new Coordinate(16, 10));
    expected.add(new Coordinate(16, 12));
    expected.add(new Coordinate(16, 14));
    expected.add(new Coordinate(16, 16));

    Assertions.assertEquals(expected, actual);
  }

  @Test
  public void getGoalsCoordinatesForPlayer_returnsGoalCoordinatesForPlayerFour_whenCalledWithPlayerForAndGridSizeOf17() {
    var playerGoals = new PlayerGoals();
    var actual = playerGoals.getGoalCoordinatesForPlayer(QuoridorPlayer.FOUR, 17);
    Set<Coordinate> expected = new HashSet<>();
    expected.add(new Coordinate(0, 0));
    expected.add(new Coordinate(0, 2));
    expected.add(new Coordinate(0, 4));
    expected.add(new Coordinate(0, 6));
    expected.add(new Coordinate(0, 8));
    expected.add(new Coordinate(0, 10));
    expected.add(new Coordinate(0, 12));
    expected.add(new Coordinate(0, 14));
    expected.add(new Coordinate(0, 16));

    Assertions.assertEquals(expected, actual);
  }
}
