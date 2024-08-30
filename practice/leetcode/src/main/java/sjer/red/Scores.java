package sjer.red;

import java.util.Comparator;
import java.util.HashSet;
import java.util.PriorityQueue;
import java.util.Set;

// https://leetcode.com/company/pinterest/discuss/5587704/Pinterest-Onsite
public class Scores {
  public static void main(String[] args) {
    System.out.printf("expected %s, received %s%n",
        4,
        solve_pq(new int[]{1, 2, 3, 4, 5}, new int[]{1, 2, 3, 4, 5}, 1));

    System.out.printf("expected %s, received %s%n",
        2,
        solve_pq(new int[]{1, 2, 3, 4, 5}, new int[]{1, 2, 3, 4, 5}, 3));

    System.out.printf("expected %s, received %s%n",
        4,
        solve_pq(new int[]{1, 1, 2, 3, 4, 5}, new int[]{1, 1, 2, 3, 4, 5}, 1));

    System.out.printf("expected %s, received %s%n",
        0,
        solve_pq(new int[]{1, 2, 3, 4, 5}, new int[]{5, 4, 3, 2, 1}, 2));
  }

  static int solve_pq(int[] es, int[] rs, int k) {
    var esPq = new PriorityQueue<int[]>(Comparator.comparingInt(l -> l[0]));
    var rsPq = new PriorityQueue<int[]>(Comparator.comparingInt(l -> l[0]));

    for (var i = 0; i < es.length; i++) {
      esPq.offer(new int[]{es[i], i});
      rsPq.offer(new int[]{rs[i], i});
    }

    // contains candidate indexes
    Set<Integer> tmp = new HashSet<>();
    for (var i = 0; i < k; i++) {
      int[] esTop = esPq.poll();
      var idx = esTop[1];
      if (!tmp.contains(idx)) {
        while (!rsPq.isEmpty() && rsPq.peek()[1] != idx) {
          var popped = rsPq.poll();
          tmp.add(popped[1]);
        }
        var rsTop = rsPq.poll();
        while (!rsPq.isEmpty() && rsPq.peek()[0] == rsTop[0]) {
          rsPq.poll();
        }
        tmp.add(idx);
      }
    }

    return rsPq.size();
  }

  // naive solution
  // n^2
  static int solve(int[] es, int[] rs, int k) {
    var count = 0;

    for (var i = 0; i < es.length; i++) {
      var my_es = es[i];
      var my_rs = rs[i];
      var my_count = 0;

      for (var x = 0; x < es.length; x++) {
        if (i == x) {
          continue;
        }
        var their_es = es[x];
        var their_rs = rs[x];
        if (my_es > their_es && my_rs > their_rs) {
          my_count += 1;
        }
      }

      if (my_count >= k) {
        count += 1;
      }
    }

    return count;
  }
}
