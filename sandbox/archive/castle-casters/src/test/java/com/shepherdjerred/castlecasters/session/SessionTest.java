package com.shepherdjerred.castlecasters.session;

import static org.junit.jupiter.api.Assertions.*;

import com.shepherdjerred.castlecasters.ai.BoundedQuoridorAi;
import com.shepherdjerred.castlecasters.common.player.AiPlayer.Difficulty;
import com.shepherdjerred.castlecasters.logic.board.*;
import com.shepherdjerred.castlecasters.logic.match.*;
import com.shepherdjerred.castlecasters.logic.player.*;
import com.shepherdjerred.castlecasters.logic.turn.*;
import com.shepherdjerred.castlecasters.logic.turn.exception.InvalidTurnException;
import com.shepherdjerred.castlecasters.logic.turn.generator.TurnGenerator;
import com.shepherdjerred.castlecasters.logic.turn.validator.TurnValidatorFactory;
import com.shepherdjerred.castlecasters.session.SessionState.*;
import java.util.*;
import org.junit.jupiter.api.*;

public class SessionTest {
  static MatchData position(int active, Pawn... pawns) {
    return new MatchData(
        9, 10, 1, active, List.of(pawns), List.of(), Collections.nCopies(pawns.length, 10), 0);
  }

  static Pawn p(int seat, int x, int y) {
    return new Pawn(seat, x, y);
  }

  static List<Turn> moves(Match m) {
    return new ArrayList<>(new TurnGenerator(new TurnValidatorFactory()).generateValidPawnTurns(m));
  }

  @Test
  void defaultsAndCounts() {
    try (var s = new GameSession()) {
      assertEquals(Controller.LOCAL, s.snapshot().seats().getFirst().controller());
      assertEquals(Difficulty.NORMAL, s.snapshot().seats().getLast().difficulty());
      for (int n : List.of(2, 4)) {
        s.resize(n);
        s.start();
        assertEquals(n, s.snapshot().match().pawns().size());
        assertEquals(Collections.nCopies(n, 10), s.snapshot().match().wallsLeft());
        s.lobby();
      }
      assertThrows(IllegalArgumentException.class, () -> s.resize(3));
    }
  }

  @Test
  void winsForAllFourDirections() {
    var data =
        List.of(
            position(1, p(1, 8, 14), p(2, 0, 14)),
            position(2, p(1, 0, 2), p(2, 8, 2)),
            position(3, p(1, 8, 0), p(2, 8, 16), p(3, 14, 8), p(4, 16, 0)),
            position(4, p(1, 8, 0), p(2, 8, 16), p(3, 0, 0), p(4, 2, 8)));
    for (var d : data) {
      var m = d.restore();
      assertTrue(
          moves(m).stream()
              .map(m::doTurn)
              .anyMatch(n -> n.matchStatus().status() == MatchStatus.Status.VICTORY));
    }
  }

  @Test
  void straightJumpWins() {
    var m = position(1, p(1, 8, 12), p(2, 8, 14)).restore();
    var t =
        new JumpPawnStraightTurn(
            QuoridorPlayer.ONE,
            new Coordinate(8, 12),
            new Coordinate(8, 16),
            new Coordinate(8, 14));
    assertEquals(QuoridorPlayer.ONE, m.doTurn(t).matchStatus().victor());
  }

  @Test
  void diagonalJumpAtEdgeAndBehindWall() {
    var m = position(1, p(1, 8, 14), p(2, 8, 16)).restore();
    var edge =
        new JumpPawnDiagonalTurn(
            QuoridorPlayer.ONE,
            new Coordinate(8, 14),
            new Coordinate(6, 16),
            new Coordinate(8, 16));
    assertEquals(MatchStatus.Status.VICTORY, m.doTurn(edge).matchStatus().status());
    var open = position(1, p(1, 8, 8), p(2, 8, 10)).restore();
    var diagonal =
        new JumpPawnDiagonalTurn(
            QuoridorPlayer.ONE, new Coordinate(8, 8), new Coordinate(6, 10), new Coordinate(8, 10));
    assertThrows(InvalidTurnException.class, () -> open.doTurn(diagonal));
    var w = new Wall(2, 8, 11, false);
    var blocked =
        new MatchData(9, 10, 1, 1, List.of(p(1, 8, 8), p(2, 8, 10)), List.of(w), List.of(10, 9), 0)
            .restore();
    assertEquals(
        new Coordinate(6, 10),
        blocked.doTurn(diagonal).board().getPawnLocation(QuoridorPlayer.ONE));
  }

  @Test
  void wallsRejectOverlapCrossingAndNoPath() {
    var m = position(1, p(1, 0, 0), p(2, 8, 16)).restore();
    var first = new TurnData("HORIZONTAL", 1, 0, 1, 0, 0);
    var n = m.doTurn(first.turn(m));
    assertEquals(9, n.getWallsLeft(QuoridorPlayer.ONE));
    assertThrows(
        InvalidTurnException.class,
        () -> n.doTurn(new TurnData("VERTICAL", 2, 1, 0, 0, 0).turn(n)));
    assertThrows(
        InvalidTurnException.class,
        () -> n.doTurn(new TurnData("HORIZONTAL", 2, 0, 1, 0, 0).turn(n)));
    assertThrows(
        InvalidTurnException.class,
        () -> n.doTurn(new TurnData("VERTICAL", 2, 1, 0, 0, 0).turn(n)));
    // Seal the upper-right exit of a corner pawn after blocking its right side.
    var corner =
        new MatchData(
                9,
                10,
                1,
                1,
                List.of(p(1, 0, 0), p(2, 8, 16)),
                List.of(new Wall(2, 1, 0, true)),
                List.of(10, 9),
                0)
            .restore();
    assertThrows(
        InvalidTurnException.class,
        () -> corner.doTurn(new TurnData("HORIZONTAL", 1, 0, 1, 0, 0).turn(corner)));
  }

  @Test
  void snapshotRoundTripAndCorruption() {
    var d = position(1, p(1, 8, 0), p(2, 8, 16));
    assertEquals(d, MatchData.of(d.restore(), List.of()));
    assertThrows(
        IllegalArgumentException.class, () -> position(1, p(1, -2, 0), p(2, 8, 16)).restore());
    assertThrows(
        IllegalArgumentException.class, () -> position(1, p(1, 8, 0), p(2, 8, 0)).restore());
    assertThrows(
        IllegalArgumentException.class,
        () -> new MatchData(9, 10, 1, 1, d.pawns(), List.of(), List.of(9, 10), 0).restore());
  }

  @Test
  void authorityRevisionDuplicateAndTerminal() {
    try (var s = new GameSession()) {
      s.fixture(position(1, p(1, 8, 14), p(2, 0, 14)));
      long rev = s.snapshot().revision();
      var turn = new TurnData("MOVE", 1, 8, 16, 0, 0);
      assertThrows(IllegalArgumentException.class, () -> s.turn("a", rev, turn, Set.of(2)));
      assertThrows(IllegalArgumentException.class, () -> s.turn("a", rev - 1, turn, Set.of(1)));
      s.turn("a", rev, turn, Set.of(1));
      assertEquals(Phase.FINISHED, s.snapshot().phase());
      assertThrows(
          IllegalArgumentException.class,
          () -> s.turn("a", s.snapshot().revision(), turn, Set.of(1)));
      assertTrue(
          new TurnGenerator(new TurnValidatorFactory()).generateValidTurns(s.match()).isEmpty());
      s.lobby();
      s.start();
      assertEquals(Phase.PLAYING, s.snapshot().phase());
    }
  }

  @Test
  void pauseRejoinAndReplacement() {
    try (var s = new GameSession()) {
      s.start();
      s.disconnect(2);
      assertEquals(Phase.PAUSED, s.snapshot().phase());
      s.reconnect(2);
      assertEquals(Phase.PLAYING, s.snapshot().phase());
      s.disconnect(2);
      s.replaceDisconnected();
      assertEquals(Controller.AI, s.snapshot().seats().get(1).controller());
      assertEquals(Phase.PLAYING, s.snapshot().phase());
    }
  }

  @Test
  void aiAllDifficultiesAndCountsAreLegalAndRepeatable() {
    for (int count : List.of(2, 4))
      for (var level : Difficulty.values()) {
        var m =
            Match.from(
                new MatchSettings(
                    0, QuoridorPlayer.ONE, count == 2 ? PlayerCount.TWO : PlayerCount.FOUR),
                new BoardSettings(9, count == 2 ? PlayerCount.TWO : PlayerCount.FOUR));
        var ai = new BoundedQuoridorAi(BoundedQuoridorAi.Budget.forDifficulty(level), true);
        var first = ai.choose(m);
        var second = ai.choose(m);
        assertEquals(first, second);
        assertDoesNotThrow(() -> m.doTurn(first.turn()));
        assertTrue(first.nodes() <= BoundedQuoridorAi.Budget.forDifficulty(level).nodes());
      }
  }

  @Test
  void aiChoosesImmediateWinAndCancels() {
    var m = position(1, p(1, 8, 14), p(2, 0, 14)).restore();
    var ai = new BoundedQuoridorAi(Difficulty.HARD);
    assertEquals(
        MatchStatus.Status.VICTORY, m.doTurn(ai.calculateBestTurn(m)).matchStatus().status());
    Thread.currentThread().interrupt();
    try {
      assertThrows(
          java.util.concurrent.CancellationException.class,
          () -> ai.choose(position(1, p(1, 8, 0), p(2, 8, 16)).restore()));
    } finally {
      Thread.interrupted();
    }
  }

  @Test
  void aiWithWallsHonorsDeadlineAndReturnsLegalMove() {
    for (int count : List.of(2, 4))
      for (var level : Difficulty.values()) {
        var pc = count == 2 ? PlayerCount.TWO : PlayerCount.FOUR;
        var match =
            Match.from(new MatchSettings(10, QuoridorPlayer.ONE, pc), new BoardSettings(9, pc));
        var budget = BoundedQuoridorAi.Budget.forDifficulty(level);
        var result =
            assertTimeoutPreemptively(
                java.time.Duration.ofMillis(budget.milliseconds() + 1500),
                () -> new BoundedQuoridorAi(level).choose(match));
        assertDoesNotThrow(() -> match.doTurn(result.turn()));
        assertTrue(result.nodes() <= budget.nodes());
      }
  }

  @Test
  void aiCompletesGamesAndSessionLifecycle() throws Exception {
    for (int count : List.of(2, 4)) {
      var pc = count == 2 ? PlayerCount.TWO : PlayerCount.FOUR;
      var m = Match.from(new MatchSettings(0, QuoridorPlayer.ONE, pc), new BoardSettings(9, pc));
      var ai = new BoundedQuoridorAi(new BoundedQuoridorAi.Budget(150, 1000, 1, 1), true);
      for (int i = 0; i < 160 && m.matchStatus().status() != MatchStatus.Status.VICTORY; i++)
        m = m.doTurn(ai.calculateBestTurn(m));
      assertEquals(MatchStatus.Status.VICTORY, m.matchStatus().status());
    }
    for (int repeat = 0; repeat < 3; repeat++)
      try (var s = new GameSession()) {
        s.start();
        var m = s.match();
        var move = moves(m).getFirst();
        s.turn("go", s.snapshot().revision(), TurnData.of(move), Set.of(1));
        s.update();
        assertTrue(s.snapshot().aiThinking());
        s.disconnect(2);
        s.lobby();
      }
    assertTrue(
        Thread.getAllStackTraces().keySet().stream()
            .noneMatch(t -> t.isAlive() && t.getName().equals("CASTLE_AI")));
  }
}
