package com.shepherdjerred.thestorm.rwfbots.domain.director;

import java.util.ArrayList;
import java.util.List;

/**
 * The Plackett-Luce rating update from OpenSkill (Weng and Lin, "A Bayesian Approximation Method
 * for Online Ranking", JMLR 2011, section 4.1.2). Of the OpenSkill models this is the default and
 * the one that handles ties and more than two teams without pairwise bookkeeping, which suits a
 * mode that may later run three-team rounds.
 *
 * <p>Each team's strength is the sum of its players' means; the update moves every player's mean by
 * their own variance over the common scale {@code c}, times how much better or worse the team did
 * than its strength predicted, and shrinks their deviation accordingly. Humans and bots share one
 * ladder so bots can be matched against the human median.
 */
public final class OpenSkill {

  /** The performance noise of a single game, OpenSkill's default. */
  public static final double BETA = 25.0 / 6;

  /** Deviations never shrink by more than this fraction of their variance in one game. */
  public static final double KAPPA = 1.0e-4;

  private OpenSkill() {}

  /**
   * The ratings after a game.
   *
   * @param teams each team's players
   * @param ranks each team's finishing rank, 0 best; equal ranks are ties
   */
  public static List<List<Rating>> rate(List<List<Rating>> teams, List<Integer> ranks) {
    if (teams.size() < 2 || teams.size() != ranks.size()) {
      throw new IllegalArgumentException("need at least two teams, each with a rank");
    }
    var game = new Game(teams, ranks);
    var result = new ArrayList<List<Rating>>(teams.size());
    for (var i = 0; i < teams.size(); i++) {
      result.add(game.update(i));
    }
    return List.copyOf(result);
  }

  /** The team sums and the common scale of one game. */
  private static final class Game {
    private final List<List<Rating>> teams;
    private final List<Integer> ranks;
    private final double[] mu;
    private final double c;
    private final double[] sumQ;
    private final int[] ties;

    Game(List<List<Rating>> teams, List<Integer> ranks) {
      this.teams = teams;
      this.ranks = ranks;
      var n = teams.size();
      mu = new double[n];
      var scale = 0.0;
      for (var i = 0; i < n; i++) {
        if (teams.get(i).isEmpty()) {
          throw new IllegalArgumentException("a team needs at least one player");
        }
        var sigmaSq = 0.0;
        for (var rating : teams.get(i)) {
          mu[i] += rating.mu();
          sigmaSq += rating.sigma() * rating.sigma();
        }
        scale += sigmaSq + BETA * BETA;
      }
      c = Math.sqrt(scale);
      sumQ = new double[n];
      ties = new int[n];
      for (var q = 0; q < n; q++) {
        for (var i = 0; i < n; i++) {
          if (ranks.get(i) >= ranks.get(q)) {
            sumQ[q] += Math.exp(mu[i] / c);
          }
          if (ranks.get(i).equals(ranks.get(q))) {
            ties[q]++;
          }
        }
      }
    }

    List<Rating> update(int i) {
      var omega = 0.0;
      var delta = 0.0;
      for (var q = 0; q < teams.size(); q++) {
        if (ranks.get(q) > ranks.get(i)) {
          continue;
        }
        var p = Math.exp(mu[i] / c) / sumQ[q];
        omega += (q == i ? 1 - p : -p) / ties[q];
        delta += p * (1 - p) / ties[q];
      }
      var updated = new ArrayList<Rating>();
      for (var rating : teams.get(i)) {
        var variance = rating.sigma() * rating.sigma();
        var newMu = rating.mu() + variance / c * omega;
        var shrink = Math.max(1 - variance / (c * c) * delta, KAPPA);
        updated.add(new Rating(newMu, rating.sigma() * Math.sqrt(shrink)));
      }
      return List.copyOf(updated);
    }
  }

  /** The chance team {@code a} beats team {@code b}, from the normal model of a two-team game. */
  public static double winProbability(List<Rating> a, List<Rating> b) {
    var muA = a.stream().mapToDouble(Rating::mu).sum();
    var muB = b.stream().mapToDouble(Rating::mu).sum();
    var variance =
        a.stream().mapToDouble(r -> r.sigma() * r.sigma()).sum()
            + b.stream().mapToDouble(r -> r.sigma() * r.sigma()).sum()
            + 2 * BETA * BETA;
    return Normal.cdf((muA - muB) / Math.sqrt(variance));
  }
}
