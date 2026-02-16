package com.shepherdjerred.castlecasters.logic.match;


import com.shepherdjerred.castlecasters.logic.player.PlayerCount;
import com.shepherdjerred.castlecasters.logic.player.QuoridorPlayer;
import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;

public class ActivePlayerTrackerTest {
  @Test
  public void nextActivePlayer_ReturnsPlayerTwo_WhenPlayerOneIsPassedInTwoPlayerGame() {
    var activePlayerTracker = new ActivePlayerTracker(QuoridorPlayer.ONE, PlayerCount.TWO);
    var actual = activePlayerTracker.getNextActivePlayerId();
    var expected = QuoridorPlayer.TWO;
    Assertions.assertEquals(actual, expected);
  }

  @Test
  public void nextActivePlayer_ReturnsPlayerOne_WhenPlayerTwoIsPassedInTwoPlayerGame() {
    var activePlayerTracker = new ActivePlayerTracker(QuoridorPlayer.TWO, PlayerCount.TWO);
    var actual = activePlayerTracker.getNextActivePlayerId();
    var expected = QuoridorPlayer.ONE;
    Assertions.assertEquals(actual, expected);
  }

  @Test
  public void nextActivePlayer_ReturnsPlayerTwo_WhenPlayerOneIsPassedInFourPlayerGame() {
    var activePlayerTracker = new ActivePlayerTracker(QuoridorPlayer.ONE, PlayerCount.FOUR);
    var actual = activePlayerTracker.getNextActivePlayerId();
    var expected = QuoridorPlayer.TWO;
    Assertions.assertEquals(actual, expected);
  }

  @Test
  public void nextActivePlayer_ReturnsPlayerThree_WhenPlayerTwoIsPassedInFourPlayerGame() {
    var activePlayerTracker = new ActivePlayerTracker(QuoridorPlayer.TWO, PlayerCount.FOUR);
    var actual = activePlayerTracker.getNextActivePlayerId();
    var expected = QuoridorPlayer.THREE;
    Assertions.assertEquals(actual, expected);
  }

  @Test
  public void nextActivePlayer_ReturnsPlayerFour_WhenPlayerThreeIsPassedInFourPlayerGame() {
    var activePlayerTracker = new ActivePlayerTracker(QuoridorPlayer.THREE, PlayerCount.FOUR);
    var actual = activePlayerTracker.getNextActivePlayerId();
    var expected = QuoridorPlayer.FOUR;
    Assertions.assertEquals(actual, expected);
  }

  @Test
  public void nextActivePlayer_ReturnsPlayerOne_WhenPlayerFourIsPassedInFourPlayerGame() {
    var activePlayerTracker = new ActivePlayerTracker(QuoridorPlayer.FOUR, PlayerCount.FOUR);
    var actual = activePlayerTracker.getNextActivePlayerId();
    var expected = QuoridorPlayer.ONE;
    Assertions.assertEquals(actual, expected);
  }

  @Test
  public void getInactivePlayers_ReturnsPlayerTwo_WhenPlayerOneIsPassedInTwoPlayerGame() {
    var activePlayerTracker = new ActivePlayerTracker(QuoridorPlayer.ONE, PlayerCount.TWO);
    var actual = activePlayerTracker.getInactivePlayers();
    var expected = QuoridorPlayer.TWO;
    Assertions.assertTrue(actual.contains(expected));
    Assertions.assertEquals(1, actual.size());
  }

  @Test
  public void getInactivePlayers_ReturnsPlayerOne_WhenPlayerTwoIsPassedInTwoPlayerGame() {
    var activePlayerTracker = new ActivePlayerTracker(QuoridorPlayer.TWO, PlayerCount.TWO);
    var actual = activePlayerTracker.getInactivePlayers();
    var expected = QuoridorPlayer.ONE;
    Assertions.assertTrue(actual.contains(expected));
    Assertions.assertEquals(1, actual.size());
  }

  @Test
  public void getInactivePlayers_ReturnsPlayersTwoThreeFour_WhenPlayerOneIsPassedInFourPlayerGame() {
    var activePlayerTracker = new ActivePlayerTracker(QuoridorPlayer.ONE, PlayerCount.FOUR);
    var actual = activePlayerTracker.getInactivePlayers();
    var expectedOne = QuoridorPlayer.TWO;
    var expectedTwo = QuoridorPlayer.THREE;
    var expectedThree = QuoridorPlayer.FOUR;
    Assertions.assertTrue(actual.contains(expectedOne));
    Assertions.assertTrue(actual.contains(expectedTwo));
    Assertions.assertTrue(actual.contains(expectedThree));
    Assertions.assertEquals(3, actual.size());
  }

  @Test
  public void getInactivePlayers_ReturnsPlayersOneThreeFour_WhenPlayerTwoIsPassedInFourPlayerGame() {
    var activePlayerTracker = new ActivePlayerTracker(QuoridorPlayer.TWO, PlayerCount.FOUR);
    var actual = activePlayerTracker.getInactivePlayers();
    var expectedOne = QuoridorPlayer.ONE;
    var expectedTwo = QuoridorPlayer.THREE;
    var expectedThree = QuoridorPlayer.FOUR;
    Assertions.assertTrue(actual.contains(expectedOne));
    Assertions.assertTrue(actual.contains(expectedTwo));
    Assertions.assertTrue(actual.contains(expectedThree));
    Assertions.assertEquals(3, actual.size());
  }

  @Test
  public void getInactivePlayers_ReturnsPlayersOneTwoFour_WhenPlayerThreeIsPassedInFourPlayerGame() {
    var activePlayerTracker = new ActivePlayerTracker(QuoridorPlayer.THREE, PlayerCount.FOUR);
    var actual = activePlayerTracker.getInactivePlayers();
    var expectedOne = QuoridorPlayer.ONE;
    var expectedTwo = QuoridorPlayer.TWO;
    var expectedThree = QuoridorPlayer.FOUR;
    Assertions.assertTrue(actual.contains(expectedOne));
    Assertions.assertTrue(actual.contains(expectedTwo));
    Assertions.assertTrue(actual.contains(expectedThree));
    Assertions.assertEquals(3, actual.size());
  }

  @Test
  public void getInactivePlayers_ReturnsPlayersOneTwoThree_WhenPlayerFourIsPassedInFourPlayerGame() {
    var activePlayerTracker = new ActivePlayerTracker(QuoridorPlayer.FOUR, PlayerCount.FOUR);
    var actual = activePlayerTracker.getInactivePlayers();
    var expectedOne = QuoridorPlayer.ONE;
    var expectedTwo = QuoridorPlayer.TWO;
    var expectedThree = QuoridorPlayer.THREE;
    Assertions.assertTrue(actual.contains(expectedOne));
    Assertions.assertTrue(actual.contains(expectedTwo));
    Assertions.assertTrue(actual.contains(expectedThree));
    Assertions.assertEquals(3, actual.size());
  }
}
