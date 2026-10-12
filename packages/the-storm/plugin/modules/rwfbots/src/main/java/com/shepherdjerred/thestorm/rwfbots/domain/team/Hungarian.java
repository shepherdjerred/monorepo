package com.shepherdjerred.thestorm.rwfbots.domain.team;

import java.util.Arrays;

/**
 * The Kuhn-Munkres assignment algorithm: given a profit for every (row, column) pair, the column
 * for each row that maximises the total, each column used at most once. Rows must not outnumber
 * columns. O(rows squared times columns).
 */
public final class Hungarian {

  private static final double INF = Double.POSITIVE_INFINITY;

  private Hungarian() {}

  /** The column assigned to each row of {@code profit}, maximising the summed profit. */
  public static int[] maximize(double[][] profit) {
    var rows = profit.length;
    if (rows == 0) {
      return new int[0];
    }
    var cols = profit[0].length;
    if (rows > cols) {
      throw new IllegalArgumentException("rows must not outnumber columns");
    }
    var best = 0.0;
    for (var row : profit) {
      if (row.length != cols) {
        throw new IllegalArgumentException("profit matrix must be rectangular");
      }
      for (var value : row) {
        if (!Double.isFinite(value)) {
          throw new IllegalArgumentException("profits must be finite");
        }
        best = Math.max(best, value);
      }
    }
    var cost = new double[rows + 1][cols + 1];
    for (var i = 1; i <= rows; i++) {
      for (var j = 1; j <= cols; j++) {
        cost[i][j] = best - profit[i - 1][j - 1];
      }
    }
    var solver = new Solver(cost, rows, cols);
    for (var i = 1; i <= rows; i++) {
      solver.addRow(i);
    }
    return solver.assignment();
  }

  /** The potentials formulation over a 1-indexed cost matrix, one row at a time. */
  private static final class Solver {
    private final double[][] cost;
    private final int rows;
    private final int cols;
    private final double[] u;
    private final double[] v;
    private final int[] assignedRow;
    private final int[] way;
    private double[] minV = new double[0];
    private boolean[] used = new boolean[0];

    Solver(double[][] cost, int rows, int cols) {
      this.cost = cost;
      this.rows = rows;
      this.cols = cols;
      u = new double[rows + 1];
      v = new double[cols + 1];
      assignedRow = new int[cols + 1];
      way = new int[cols + 1];
    }

    void addRow(int row) {
      assignedRow[0] = row;
      var freeColumn = 0;
      minV = new double[cols + 1];
      Arrays.fill(minV, INF);
      used = new boolean[cols + 1];
      do {
        used[freeColumn] = true;
        var next = relax(assignedRow[freeColumn], freeColumn);
        freeColumn = next;
      } while (assignedRow[freeColumn] != 0);
      augment(freeColumn);
    }

    /** Lowers the reduced costs seen from {@code row} and returns the next column to visit. */
    private int relax(int row, int from) {
      var delta = INF;
      var next = 0;
      for (var j = 1; j <= cols; j++) {
        if (used[j]) {
          continue;
        }
        var current = cost[row][j] - u[row] - v[j];
        if (current < minV[j]) {
          minV[j] = current;
          way[j] = from;
        }
        if (minV[j] < delta) {
          delta = minV[j];
          next = j;
        }
      }
      for (var j = 0; j <= cols; j++) {
        if (used[j]) {
          u[assignedRow[j]] += delta;
          v[j] -= delta;
        } else {
          minV[j] -= delta;
        }
      }
      return next;
    }

    private void augment(int freeColumn) {
      var column = freeColumn;
      do {
        var previous = way[column];
        assignedRow[column] = assignedRow[previous];
        column = previous;
      } while (column != 0);
    }

    int[] assignment() {
      var result = new int[rows];
      for (var j = 1; j <= cols; j++) {
        if (assignedRow[j] != 0) {
          result[assignedRow[j] - 1] = j - 1;
        }
      }
      return result;
    }
  }
}
