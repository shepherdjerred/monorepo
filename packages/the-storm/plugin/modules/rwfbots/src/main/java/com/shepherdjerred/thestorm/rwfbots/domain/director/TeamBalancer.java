package com.shepherdjerred.thestorm.rwfbots.domain.director;

import static java.util.Comparator.comparingDouble;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;

/**
 * Splits a lobby into teams of equal size (within one) whose summed means are as close as the
 * players allow: a snake draft by rating, then pairwise swaps while they narrow the spread.
 * Deterministic: equal lobbies give equal teams.
 */
public final class TeamBalancer {

  private static final int MAX_SWAP_ROUNDS = 100;

  private TeamBalancer() {}

  public static List<List<Participant>> balance(List<Participant> lobby, int teamCount) {
    if (teamCount < 2 || lobby.size() < teamCount) {
      throw new IllegalArgumentException("need at least two teams with someone on each");
    }
    var ids = new HashSet<String>();
    for (var participant : lobby) {
      if (!ids.add(participant.id())) {
        throw new IllegalArgumentException("duplicate participant " + participant.id());
      }
    }
    var sorted = new ArrayList<>(lobby);
    sorted.sort(
        comparingDouble((Participant p) -> -p.rating().mu()).thenComparing(Participant::id));
    var teams = new ArrayList<List<Participant>>();
    for (var i = 0; i < teamCount; i++) {
      teams.add(new ArrayList<>());
    }
    for (var i = 0; i < sorted.size(); i++) {
      var round = i / teamCount;
      var slot = i % teamCount;
      var team = round % 2 == 0 ? slot : teamCount - 1 - slot;
      teams.get(team).add(sorted.get(i));
    }
    improve(teams);
    return teams.stream().map(List::copyOf).toList();
  }

  private static void improve(List<List<Participant>> teams) {
    for (var round = 0; round < MAX_SWAP_ROUNDS; round++) {
      if (!swapOnce(teams)) {
        return;
      }
    }
  }

  private static boolean swapOnce(List<List<Participant>> teams) {
    var before = spread(teams);
    for (var a = 0; a < teams.size(); a++) {
      for (var b = a + 1; b < teams.size(); b++) {
        if (trySwap(teams.get(a), teams.get(b), teams, before)) {
          return true;
        }
      }
    }
    return false;
  }

  private static boolean trySwap(
      List<Participant> a, List<Participant> b, List<List<Participant>> teams, double before) {
    for (var i = 0; i < a.size(); i++) {
      for (var j = 0; j < b.size(); j++) {
        var x = a.get(i);
        var y = b.get(j);
        a.set(i, y);
        b.set(j, x);
        if (spread(teams) < before - 1.0e-9) {
          return true;
        }
        a.set(i, x);
        b.set(j, y);
      }
    }
    return false;
  }

  /** The difference between the strongest and weakest team's summed means. */
  public static double spread(List<List<Participant>> teams) {
    var max = Double.NEGATIVE_INFINITY;
    var min = Double.POSITIVE_INFINITY;
    for (var team : teams) {
      var sum = team.stream().mapToDouble(p -> p.rating().mu()).sum();
      max = Math.max(max, sum);
      min = Math.min(min, sum);
    }
    return max - min;
  }
}
