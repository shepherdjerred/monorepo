package com.shepherdjerred.castlecasters.ai;

import com.shepherdjerred.castlecasters.common.player.AiPlayer.Difficulty;
import com.shepherdjerred.castlecasters.logic.board.Coordinate;
import com.shepherdjerred.castlecasters.logic.match.*;
import com.shepherdjerred.castlecasters.logic.player.*;
import com.shepherdjerred.castlecasters.logic.turn.*;
import com.shepherdjerred.castlecasters.logic.turn.generator.TurnGenerator;
import com.shepherdjerred.castlecasters.logic.turn.validator.TurnValidatorFactory;
import java.util.*;
import java.util.concurrent.CancellationException;

/** Iterative alpha-beta for two players; Max-N for four independent players. */
public final class BoundedQuoridorAi implements QuoridorAi {
  public record Budget(long milliseconds, int nodes, int twoPlies, int fourPlies) {
    public static Budget forDifficulty(Difficulty difficulty) {
      return switch (difficulty) {
        case EASY -> new Budget(150, 1000, 1, 1);
        case NORMAL -> new Budget(750, 10000, 3, 2);
        case HARD -> new Budget(2000, 50000, 6, 3);
      };
    }
  }

  public record Result(Turn turn, int nodes, int depth) {}

  private final Budget budget;
  private final boolean deterministic;
  private final TurnGenerator generator = new TurnGenerator(new TurnValidatorFactory());
  private long deadline;
  private int nodes;

  private static final class Exhausted extends RuntimeException {
    Exhausted() {
      super(null, null, false, false);
    }
  }

  public BoundedQuoridorAi(Difficulty difficulty) {
    this(Budget.forDifficulty(difficulty), false);
  }

  public BoundedQuoridorAi(Budget budget, boolean deterministic) {
    if (budget.nodes() < 1
        || budget.milliseconds() < 1
        || budget.twoPlies() < 1
        || budget.fourPlies() < 1) throw new IllegalArgumentException("Invalid search budget");
    this.budget = budget;
    this.deterministic = deterministic;
  }

  @Override
  public Turn calculateBestTurn(Match match) {
    return choose(match).turn();
  }

  public Result choose(Match match) {
    nodes = 0;
    deadline = System.nanoTime() + budget.milliseconds() * 1_000_000;
    var moves = sort(match, new ArrayList<>(generator.generateValidPawnTurns(match)));
    if (moves.isEmpty()) throw new IllegalStateException("No legal turn in an active match");
    var root = match.getActivePlayerId();
    Turn best = moves.getFirst();
    for (Turn move : moves) {
      if (match.doTurnUnchecked(move).matchStatus().status() == MatchStatus.Status.VICTORY)
        return new Result(move, nodes, 1);
    }
    int completed = 0;
    boolean four = match.matchSettings().playerCount() == PlayerCount.FOUR;
    int maxDepth = four ? budget.fourPlies() : budget.twoPlies();
    try {
      moves = ordered(match);
      for (int depth = 1; depth <= maxDepth; depth++) {
        Turn iterationBest = best;
        double score = -Double.MAX_VALUE;
        for (Turn turn : moves) {
          check();
          Match next = match.doTurnUnchecked(turn);
          double value =
              four
                  ? maxN(next, depth - 1)[root.ordinal()]
                  : alphaBeta(next, depth - 1, root, -Double.MAX_VALUE, Double.MAX_VALUE);
          if (value > score) {
            score = value;
            iterationBest = turn;
          }
        }
        best = iterationBest;
        completed = depth;
      }
    } catch (Exhausted ignored) {
      /* Keep the last fully evaluated iteration. */
    }
    return new Result(best, nodes, completed);
  }

  private void check() {
    checkpoint();
    nodes++;
  }

  private void checkpoint() {
    if (Thread.currentThread().isInterrupted()) throw new CancellationException("AI cancelled");
    if (nodes >= budget.nodes() || (!deterministic && System.nanoTime() >= deadline))
      throw new Exhausted();
  }

  private double alphaBeta(Match match, int depth, QuoridorPlayer root, double alpha, double beta) {
    check();
    if (depth == 0 || match.matchStatus().status() == MatchStatus.Status.VICTORY)
      return utility(match)[root.ordinal()];
    boolean maximize = match.getActivePlayerId() == root;
    double best = maximize ? -Double.MAX_VALUE : Double.MAX_VALUE;
    for (Turn turn : ordered(match)) {
      double value = alphaBeta(match.doTurnUnchecked(turn), depth - 1, root, alpha, beta);
      best = maximize ? Math.max(best, value) : Math.min(best, value);
      if (maximize) alpha = Math.max(alpha, best);
      else beta = Math.min(beta, best);
      if (beta <= alpha) break;
    }
    return best;
  }

  private double[] maxN(Match match, int depth) {
    check();
    if (depth == 0 || match.matchStatus().status() == MatchStatus.Status.VICTORY)
      return utility(match);
    int active = match.getActivePlayerId().ordinal();
    double[] best = null;
    for (Turn turn : ordered(match)) {
      double[] value = maxN(match.doTurnUnchecked(turn), depth - 1);
      if (best == null || value[active] > best[active]) best = value;
    }
    if (best == null) throw new IllegalStateException("Active position has no legal move");
    return best;
  }

  private List<Turn> ordered(Match match) {
    return sort(match, new ArrayList<>(generator.generateValidTurns(match, this::checkpoint)));
  }

  private List<Turn> sort(Match match, List<Turn> moves) {
    var distances = distanceMap(match, match.getActivePlayerId());
    moves.sort(
        Comparator.comparingInt(
                (Turn turn) ->
                    turn instanceof MovePawnTurn move
                        ? distances[move.destination().y() / 2][move.destination().x() / 2]
                        : 1000)
            .thenComparing(Turn::toString));
    return moves;
  }

  private double[] utility(Match match) {
    int count = match.matchSettings().playerCount().toInt();
    double[] result = new double[count];
    if (match.matchStatus().status() == MatchStatus.Status.VICTORY) {
      Arrays.fill(result, -1_000_000);
      result[match.matchStatus().victor().ordinal()] = 1_000_000;
      return result;
    }
    int[] paths = new int[count];
    for (int i = 0; i < count; i++) {
      var player = QuoridorPlayer.fromInt(i + 1);
      var pawn = match.board().getPawnLocation(player);
      paths[i] = distanceMap(match, player)[pawn.y() / 2][pawn.x() / 2];
    }
    for (int i = 0; i < count; i++) {
      int nearestOpponent = Integer.MAX_VALUE;
      for (int j = 0; j < count; j++)
        if (j != i) nearestOpponent = Math.min(nearestOpponent, paths[j]);
      result[i] =
          -100 * paths[i]
              + 60 * nearestOpponent
              + match.getWallsLeft(QuoridorPlayer.fromInt(i + 1));
    }
    return result;
  }

  public static int[][] distanceMap(Match match, QuoridorPlayer player) {
    int size = match.board().getBoardSize();
    int[][] distances = new int[size][size];
    for (int[] row : distances) Arrays.fill(row, size * size + 1);
    var queue = new ArrayDeque<Coordinate>();
    for (var goal :
        new PlayerGoals().getGoalCoordinatesForPlayer(player, match.board().getGridSize())) {
      distances[goal.y() / 2][goal.x() / 2] = 0;
      queue.add(goal);
    }
    while (!queue.isEmpty()) {
      var cell = queue.remove();
      for (var next : match.board().getPawnSpacesAdjacentToPawnSpace(cell)) {
        if (match.board().hasWall(Coordinate.calculateMidpoint(cell, next))) continue;
        int distance = distances[cell.y() / 2][cell.x() / 2] + 1;
        if (distance < distances[next.y() / 2][next.x() / 2]) {
          distances[next.y() / 2][next.x() / 2] = distance;
          queue.add(next);
        }
      }
    }
    return distances;
  }
}
