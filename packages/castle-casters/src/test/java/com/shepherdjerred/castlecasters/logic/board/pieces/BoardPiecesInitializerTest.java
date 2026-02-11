package com.shepherdjerred.castlecasters.logic.board.pieces;

import com.shepherdjerred.castlecasters.logic.board.BoardSettings;
import com.shepherdjerred.castlecasters.logic.board.Coordinate;
import com.shepherdjerred.castlecasters.logic.player.PlayerCount;
import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;

public class BoardPiecesInitializerTest {

  @Test
  public void getInitialPawnLocations_createsMapOfSizeTwo_whenCreatingPiecesForTwoPlayers() {
    var settings = new BoardSettings(9, PlayerCount.TWO);
    var initializer = new BoardPiecesInitializer();

    var actual = initializer.getInitialPawnLocations(settings);

    Assertions.assertEquals(2, actual.size());
  }

  @Test
  public void getInitialPawnPositions_createsMapOfSizeFour_whenCreatingPiecesForFourPlayers() {
    var settings = new BoardSettings(9, PlayerCount.FOUR);
    var initializer = new BoardPiecesInitializer();

    var actual = initializer.getInitialPawnLocations(settings);

    Assertions.assertEquals(4, actual.size());
  }

  @Test
  public void convertPawnLocationsToPieceLocations_changesTwoPawnsToTwoPieces() {
    var settings = new BoardSettings(9, PlayerCount.TWO);
    var initializer = new BoardPiecesInitializer();

    var pawnLocations = initializer.getInitialPawnLocations(settings);
    var actual = initializer.convertPawnLocationsToPieceLocations(pawnLocations);

    Assertions.assertEquals(2, actual.size());
  }

  @Test
  public void convertPawnLocationsToPieceLocations_changesFourPawnsToFourPieces() {
    var settings = new BoardSettings(9, PlayerCount.FOUR);
    var initializer = new BoardPiecesInitializer();

    var pawnLocations = initializer.getInitialPawnLocations(settings);
    var actual = initializer.convertPawnLocationsToPieceLocations(pawnLocations);

    Assertions.assertEquals(4, actual.size());
  }

  @Test
  public void getStartingPawnCoordinateForPlayerOne_findsStartingPositionForPlayerOne() {
    var settings = new BoardSettings(9, PlayerCount.TWO);
    var initializer = new BoardPiecesInitializer();

    var actual = initializer.getInitialPawnLocations(settings);

    Assertions.assertTrue(actual.containsValue(new Coordinate(8, 0)));
  }

  @Test
  public void getStartingPawnCoordinateForPlayerTwo_findsStartingPositionForPlayerTwo() {
    var settings = new BoardSettings(9, PlayerCount.TWO);
    var initializer = new BoardPiecesInitializer();

    var actual = initializer.getInitialPawnLocations(settings);

    Assertions.assertTrue(actual.containsValue(new Coordinate(8, 16)));
  }

  @Test
  public void getStartingPawnCoordinateForPlayerThree_findsStartingPositionForPlayerThree() {
    var settings = new BoardSettings(9, PlayerCount.FOUR);
    var initializer = new BoardPiecesInitializer();

    var actual = initializer.getInitialPawnLocations(settings);

    Assertions.assertTrue(actual.containsValue(new Coordinate(0, 8)));
  }

  @Test
  public void getStartingPawnCoordinateForPlayerFour_findsStartingPositionForPlayerFour() {
    var settings = new BoardSettings(9, PlayerCount.FOUR);
    var initializer = new BoardPiecesInitializer();

    var actual = initializer.getInitialPawnLocations(settings);

    Assertions.assertTrue(actual.containsValue(new Coordinate(16, 8)));
  }
}
