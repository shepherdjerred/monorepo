package sjer.red;

import java.util.Arrays;
import java.util.PriorityQueue;

// https://leetcode.com/discuss/interview-experience/4180137/Pinterest-or-MLE-or-Phone-screen/
public class Wait {
  public static void main(String[] args) {
    // expect 2
    System.out.println(solve(5, 4, new int[]{
        2, 3, 1, 5
    }));

    // expect 4
    System.out.println(solve(5, 4, new int[]{
        99, 99, 99, 2
    }));
  }

  static record Pair(int busyUntil, int time) {
  }

  public static int solve(int m, int n, int[] agents) {
    var pairs = Arrays.stream(agents).mapToObj((a) -> new Pair(0, a)).toList();

    var pq = new PriorityQueue<Pair>((l, r) -> {
      if (l.busyUntil == r.busyUntil) {
        return Integer.compare(l.time, r.time);
      }
      return Integer.compare(l.busyUntil, r.busyUntil);
    });

    for (var pair : pairs) {
      pq.offer(pair);
    }

    var ans = 0;
    for (var i = 0; i < m; i++) {
      // take the top off of the pq
      var result = pq.poll();
      System.out.println(result);
      // add this to the ans
      ans += result.busyUntil;
      // add this to the the pq
      pq.offer(new Pair(result.time, result.time));
    }

    return ans + pq.poll().busyUntil();
  }
}
