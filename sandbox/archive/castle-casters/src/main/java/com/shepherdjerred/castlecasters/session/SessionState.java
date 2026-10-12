package com.shepherdjerred.castlecasters.session;

import com.shepherdjerred.castlecasters.common.player.AiPlayer.Difficulty;
import com.shepherdjerred.castlecasters.common.player.Element;
import com.shepherdjerred.castlecasters.logic.board.*;
import com.shepherdjerred.castlecasters.logic.match.*;
import com.shepherdjerred.castlecasters.logic.piece.*;
import com.shepherdjerred.castlecasters.logic.player.*;
import com.shepherdjerred.castlecasters.logic.turn.*;
import java.util.*;

/** Data-only wire and presentation contracts, independent of engine internals. */
public final class SessionState {
  private SessionState() {}

  public enum Controller {
    LOCAL,
    REMOTE,
    AI
  }

  public enum Phase {
    LOBBY,
    PLAYING,
    PAUSED,
    FINISHED,
    CLOSED
  }

  public record Seat(
      int number,
      String name,
      Element element,
      Controller controller,
      Difficulty difficulty,
      boolean connected) {
    public Seat {
      if (number < 1
          || number > 4
          || name == null
          || name.length() < 1
          || name.length() > 24
          || !name.chars().allMatch(c -> c >= 32 && c < 127))
        throw new IllegalArgumentException("Names must be 1-24 printable ASCII characters");
      Objects.requireNonNull(element);
      Objects.requireNonNull(controller);
      Objects.requireNonNull(difficulty);
    }

    public Seat connection(boolean value) {
      return new Seat(number, name, element, controller, difficulty, value);
    }
  }

  public record Pawn(int seat, int x, int y) {}

  public record Wall(int seat, int x, int y, boolean vertical) {
    public WallLocation location() {
      return new WallLocation(
          new Coordinate(x, y),
          new Coordinate(x + (vertical ? 0 : 1), y + (vertical ? 1 : 0)),
          new Coordinate(x + (vertical ? 0 : 2), y + (vertical ? 2 : 0)));
    }
  }

  public record TurnData(String type, int seat, int x, int y, int pivotX, int pivotY) {
    public static TurnData of(Turn turn) {
      if (turn instanceof PlaceWallTurn wall) {
        var start = wall.location().firstCoordinate();
        return new TurnData(
            start.x() == wall.location().secondCoordinate().x() ? "VERTICAL" : "HORIZONTAL",
            turn.causer().toInt(),
            start.x(),
            start.y(),
            0,
            0);
      }
      if (turn instanceof JumpPawnTurn jump)
        return new TurnData(
            turn instanceof JumpPawnDiagonalTurn ? "DIAGONAL" : "JUMP",
            turn.causer().toInt(),
            jump.destination().x(),
            jump.destination().y(),
            jump.pivot().x(),
            jump.pivot().y());
      if (turn instanceof NormalMovePawnTurn move)
        return new TurnData(
            "MOVE", turn.causer().toInt(), move.destination().x(), move.destination().y(), 0, 0);
      throw new IllegalArgumentException("Unknown turn");
    }

    public Turn turn(Match match) {
      if (seat < 1 || seat > match.matchSettings().playerCount().toInt())
        throw new IllegalArgumentException("Invalid seat");
      var player = QuoridorPlayer.fromInt(seat);
      var source = match.board().getPawnLocation(player);
      var destination = new Coordinate(x, y);
      return switch (type) {
        case "MOVE" -> new NormalMovePawnTurn(player, source, destination);
        case "JUMP" ->
            new JumpPawnStraightTurn(player, source, destination, new Coordinate(pivotX, pivotY));
        case "DIAGONAL" ->
            new JumpPawnDiagonalTurn(player, source, destination, new Coordinate(pivotX, pivotY));
        case "VERTICAL", "HORIZONTAL" ->
            new PlaceWallTurn(player, new Wall(seat, x, y, type.equals("VERTICAL")).location());
        default -> throw new IllegalArgumentException("Unknown turn type");
      };
    }
  }

  public record MatchData(
      int boardSize,
      int wallsPerPlayer,
      int startingPlayer,
      int activePlayer,
      List<Pawn> pawns,
      List<Wall> walls,
      List<Integer> wallsLeft,
      int winner) {
    public MatchData {
      pawns = List.copyOf(pawns);
      walls = List.copyOf(walls);
      wallsLeft = List.copyOf(wallsLeft);
    }

    public static MatchData of(Match match, List<Wall> walls) {
      var pawns = new ArrayList<Pawn>();
      var bank = new ArrayList<Integer>();
      for (int i = 1; i <= match.matchSettings().playerCount().toInt(); i++) {
        var id = QuoridorPlayer.fromInt(i);
        var pawn = match.board().getPawnLocation(id);
        pawns.add(new Pawn(i, pawn.x(), pawn.y()));
        bank.add(match.getWallsLeft(id));
      }
      return new MatchData(
          match.board().getBoardSize(),
          match.matchSettings().wallsPerPlayer(),
          match.matchSettings().startingQuoridorPlayer().toInt(),
          match.getActivePlayerId().toInt(),
          pawns,
          walls,
          bank,
          match.matchStatus().status() == MatchStatus.Status.VICTORY
              ? match.matchStatus().victor().toInt()
              : 0);
    }

    public Match restore() {
      int count = pawns.size();
      if ((count != 2 && count != 4)
          || wallsLeft.size() != count
          || boardSize < 3
          || boardSize > 11
          || boardSize % 2 != 1
          || startingPlayer < 1
          || startingPlayer > count
          || activePlayer < 1
          || activePlayer > count
          || wallsPerPlayer < 0
          || wallsPerPlayer > 20
          || winner < 0
          || winner > count) throw new IllegalArgumentException("Invalid match snapshot");
      var playerCount = count == 2 ? PlayerCount.TWO : PlayerCount.FOUR;
      var settings =
          new MatchSettings(wallsPerPlayer, QuoridorPlayer.fromInt(startingPlayer), playerCount);
      var boardSettings = new BoardSettings(boardSize, playerCount);
      var positions = new HashMap<QuoridorPlayer, Coordinate>();
      var pieces = new HashMap<Coordinate, Piece>();
      for (var pawn : pawns) {
        if (pawn.seat < 1 || pawn.seat > count)
          throw new IllegalArgumentException("Invalid pawn seat");
        var id = QuoridorPlayer.fromInt(pawn.seat);
        var c = new Coordinate(pawn.x, pawn.y);
        if (positions.put(id, c) != null || pieces.put(c, new PawnPiece(id)) != null)
          throw new IllegalArgumentException("Duplicate pawn");
      }
      for (var wall : walls) {
        if (wall.seat < 1
            || wall.seat > count
            || (wall.vertical
                ? wall.x % 2 != 1 || wall.y % 2 != 0
                : wall.x % 2 != 0 || wall.y % 2 != 1))
          throw new IllegalArgumentException("Invalid wall");
        var location = wall.location();
        for (var c :
            List.of(location.firstCoordinate(), location.vertex(), location.secondCoordinate())) {
          if (pieces.put(c, new WallPiece(QuoridorPlayer.fromInt(wall.seat))) != null)
            throw new IllegalArgumentException("Overlapping pieces");
        }
      }
      var board = QuoridorBoard.fromState(boardSettings, positions, pieces);
      var base = Match.from(settings, board);
      var restored =
          new Match(
              board,
              settings,
              WallBank.fromCounts(wallsLeft, wallsPerPlayer),
              new MatchStatus(
                  winner == 0 ? QuoridorPlayer.NULL : QuoridorPlayer.fromInt(winner),
                  winner == 0 ? MatchStatus.Status.IN_PROGRESS : MatchStatus.Status.VICTORY),
              base.matchHistory(),
              base.matchTurnEnactor(),
              new ActivePlayerTracker(QuoridorPlayer.fromInt(activePlayer), playerCount));
      for (int i = 1; i <= count; i++) {
        final int seat = i;
        if (walls.stream().filter(w -> w.seat() == seat).count() + wallsLeft.get(i - 1)
            != wallsPerPlayer)
          throw new IllegalArgumentException("Wall counts do not match placed walls");
        var id = QuoridorPlayer.fromInt(i);
        var pawn = board.getPawnLocation(id);
        if (com.shepherdjerred.castlecasters.ai.BoundedQuoridorAi.distanceMap(restored, id)[
                pawn.y() / 2][pawn.x() / 2]
            > boardSize * boardSize)
          throw new IllegalArgumentException("Snapshot blocks a pawn path");
        if (winner == i
            && !new PlayerGoals()
                .getGoalCoordinatesForPlayer(id, board.getGridSize())
                .contains(pawn)) throw new IllegalArgumentException("Winner is not on a goal");
      }
      return restored;
    }
  }

  public record Snapshot(
      long revision,
      Phase phase,
      String theme,
      int startingPlayer,
      List<Seat> seats,
      MatchData match,
      TurnData lastTurn,
      boolean aiThinking,
      String message) {
    public Snapshot {
      seats = List.copyOf(seats);
      Objects.requireNonNull(phase);
      Objects.requireNonNull(theme);
      Objects.requireNonNull(message);
      if (revision < 0
          || !Set.of("GRASS", "DESERT", "WINTER").contains(theme)
          || (seats.size() != 2 && seats.size() != 4)
          || startingPlayer < 1
          || startingPlayer > seats.size())
        throw new IllegalArgumentException("Invalid session snapshot");
      var elements = EnumSet.noneOf(Element.class);
      for (int i = 0; i < seats.size(); i++)
        if (seats.get(i).number() != i + 1 || !elements.add(seats.get(i).element()))
          throw new IllegalArgumentException("Invalid session seats");
      if (phase == Phase.LOBBY && match != null
          || Set.of(Phase.PLAYING, Phase.PAUSED, Phase.FINISHED).contains(phase) && match == null)
        throw new IllegalArgumentException("Missing match state");
    }
  }
}
